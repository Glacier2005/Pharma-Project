import { API_BASE } from './api/client';
import { useEffect, useMemo, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/auth-context';
import { CartProvider }          from './context/CartContext';
import { ToastProvider }         from './context/ToastContext';
import { ProtectedRoute }        from './components/ProtectedRoute';
import { LandingPage }           from './pages/LandingPage';
import { AuthPage }              from './pages/AuthPage';
import { HomePage }              from './pages/HomePage';
import { OrdersPage }            from './pages/OrdersPage';
import { OrderDetailPage }       from './pages/OrderDetailPage';
import { RiderDashboard }        from './pages/RiderDashboard';
import { AdminDashboard }        from './pages/AdminDashboard';
import { PharmacistDashboard }   from './pages/PharmacistDashboard';

const SOCKET_URL = API_BASE || window.location.origin;
const DEFAULT_CENTER = [20.5937, 78.9629];
const DEFAULT_ZOOM = 6;
function riderNeonIcon() {
  return L.divIcon({
    className: 'tracking-marker-root leaflet-div-icon',
    html: '<span class="tracking-marker-glow"></span><span class="tracking-marker-core"></span>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}
// 1. ADD THIS ABOVE TrackingScreen: The Blue Customer Icon
function customerHomeIcon() {
  return L.divIcon({
    className: 'tracking-marker-root leaflet-div-icon',
    html: '<span class="tracking-marker-glow" style="background: rgba(59, 130, 246, 0.5);"></span><span class="tracking-marker-core" style="background: #3b82f6;"></span>',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// 2. ADD THIS ABOVE TrackingScreen: The Smart Auto-Zoom
function MapBoundsSync({ riderLatLng, customerLatLng }) {
  const map = useMap();

  useEffect(() => {
    if (riderLatLng && customerLatLng) {
      // Zoom out to fit both pins
      const bounds = L.latLngBounds(
        [riderLatLng.lat, riderLatLng.lng],
        [customerLatLng.lat, customerLatLng.lng]
      );
      map.fitBounds(bounds, { padding: [70, 70], animate: true });
    } else if (riderLatLng) {
      map.setView([riderLatLng.lat, riderLatLng.lng], 15, { animate: true });
    } else if (customerLatLng) {
      map.setView([customerLatLng.lat, customerLatLng.lng], 15, { animate: true });
    }
  }, [riderLatLng, customerLatLng, map]);

  return null;
}

export function TrackingScreen({ orderId, customerLocation }) {
  const [riderLatLng, setRiderLatLng] = useState(null);

  const riderIcon = useMemo(() => riderNeonIcon(), []);
  const customerIcon = useMemo(() => customerHomeIcon(), []);

  useEffect(() => {
    if (!orderId) return;

    // Refresh authentication on mount and rejoin after reconnects.
    const socket = io(SOCKET_URL, { autoConnect: false, auth: { token: localStorage.getItem('pd_token') || '' } });
    socket.on('connect', () => socket.emit('join_tracking_room', String(orderId)));
    socket.connect();


    const onLocationUpdate = (payload) => {
      const lat = payload?.lat ?? payload?.latitude;
      const lng = payload?.lng ?? payload?.longitude;
      if (lat == null || lng == null) return;
      const nlat = Number(lat);
      const nlng = Number(lng);
      if (Number.isFinite(nlat) && Number.isFinite(nlng)) {
        setRiderLatLng({ lat: nlat, lng: nlng });
      }
    };

    socket.on('location_update', onLocationUpdate);

    return () => {
      socket.off('location_update', onLocationUpdate);
      socket.disconnect();
    };
  }, [orderId]);

  // ... rest of your TrackingScreen code ...
  const center = DEFAULT_CENTER;
  const zoom = DEFAULT_ZOOM;

  return (
    <section className="tracking-screen od-section" aria-label="Live delivery tracking">
      <h2 className="od-section-title">Live tracking</h2>
      <p className="tracking-screen-meta">
        {riderLatLng
          ? 'Rider location updates in real time.'
          : 'Waiting for rider GPS... map centers when the first update arrives.'}
      </p>
      <div className="tracking-map-frame">
        <MapContainer
          key={orderId}
          center={center}
          zoom={zoom}
          className="tracking-map-container"
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          {/* Replaced MapCenterSync with MapBoundsSync */}
          <MapBoundsSync riderLatLng={riderLatLng} customerLatLng={customerLocation} />

          {riderLatLng && (
            <Marker position={[riderLatLng.lat, riderLatLng.lng]} icon={riderIcon} />
          )}

          {/* New Customer Marker */}
          {customerLocation && (
            <Marker position={[customerLocation.lat, customerLocation.lng]} icon={customerIcon} />
          )}
        </MapContainer>
      </div>
    </section>
  );
}

import { SplashScreen }            from './components/SplashScreen';

/** After login, redirect to the right home screen by role */
function RoleHome() {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user)   return <LandingPage />;
  if (user.role === 'RIDER') return <Navigate to="/rider" replace />;
  if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;
  if (user.role === 'PHARMACIST' || user.role === 'PHARMACY_ADMIN') return <Navigate to="/pharmacist" replace />;
  return <Navigate to="/medicines" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <CartProvider>
          <Routes>
            {/* Public — smart home */}
            <Route path="/"            element={<RoleHome />} />
            <Route path="/auth"        element={<AuthPage />} />

            {/* Customer */}
            <Route path="/medicines"   element={<ProtectedRoute roles={['CUSTOMER']}><HomePage /></ProtectedRoute>} />
            <Route path="/orders"      element={<ProtectedRoute roles={['CUSTOMER']}><OrdersPage /></ProtectedRoute>} />
            <Route path="/orders/:id"  element={<ProtectedRoute roles={['CUSTOMER','RIDER','ADMIN']}><OrderDetailPage /></ProtectedRoute>} />

            {/* Rider */}
            <Route path="/rider"       element={<ProtectedRoute roles={['RIDER','ADMIN']}><RiderDashboard /></ProtectedRoute>} />

            {/* Admin */}
            <Route path="/admin"       element={<ProtectedRoute roles={['ADMIN']}><AdminDashboard /></ProtectedRoute>} />

            {/* Pharmacist */}
            <Route path="/pharmacist"  element={<ProtectedRoute roles={['PHARMACIST', 'PHARMACY_ADMIN', 'ADMIN']}><PharmacistDashboard /></ProtectedRoute>} />

            <Route path="*"            element={<Navigate to="/" replace />} />
          </Routes>
        </CartProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
