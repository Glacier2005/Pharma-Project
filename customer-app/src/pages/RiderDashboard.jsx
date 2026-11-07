import { API_BASE } from '../api/client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/auth-context';
import { useToast } from '../context/toast-context';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import io from 'socket.io-client';

const SOCKET_URL = API_BASE || window.location.origin;

function useRiderLocation(orders) {
  const [locationReady, setLocationReady] = useState(false);
  const hasActiveOrders = orders.some(o => ['ACCEPTED', 'OUT_FOR_DELIVERY'].includes(o.status));
  const toast = useToast();
  const socketRef = useRef(null);
  const ordersRef = useRef(orders);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    if (!hasActiveOrders) return;

    if (!('geolocation' in navigator)) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }

    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL, { 
        transports: ['websocket', 'polling'],
        auth: {
          token: localStorage.getItem('pd_token') || ''
        }
      });
    }
    const socket = socketRef.current;


    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setLocationReady(true);
        const { latitude, longitude } = position.coords;
        const currentTracking = ordersRef.current.filter(o => ['ACCEPTED', 'OUT_FOR_DELIVERY'].includes(o.status));
        currentTracking.forEach(order => {
          socket.emit('rider_location_update', {
            orderId: order.id,
            lat: latitude,
            lng: longitude
          });
        });
      },
      (error) => {
        setLocationReady(false);
        console.error('Geolocation error:', error);
        if (error.code === 1) toast.error('Please allow location access to share live updates with the customer.');
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      // We do not disconnect the socket here, we just stop tracking.

    };
  }, [hasActiveOrders, toast]);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  return hasActiveOrders && locationReady;
}

const NEXT_STATUS = {
  PENDING:          { label: 'Accept Order',   next: 'ACCEPTED',         cls: 'btn-action-cyan'   },
  ACCEPTED:         { label: 'Mark Picked Up', next: 'OUT_FOR_DELIVERY', cls: 'btn-action-purple' },
  OUT_FOR_DELIVERY: { label: 'Verify Delivery OTP', next: 'DELIVERED',        cls: 'btn-action-green'  },
};

const STATUS_EMOJI = { ACCEPTED: '✅ Accepted', OUT_FOR_DELIVERY: '🛵 Out for delivery', DELIVERED: '🎉 Delivered!' };

function OrderRow({ order, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [otpMode, setOtpMode] = useState(false);
  const [otp, setOtp] = useState('');
  const toast  = useToast();
  const action = NEXT_STATUS[order.status];
  const total = Number(order.total_amount ?? 0);

  async function advance() {
    if (!action) return;
    if (order.status === 'OUT_FOR_DELIVERY' && !otpMode) {
      setOtpMode(true);
      return;
    }

    setBusy(true);
    try {
      if (order.status === 'OUT_FOR_DELIVERY') {
        if (!otp || otp.length !== 6) {
          toast.error("Please enter a valid 6-digit OTP");
          setBusy(false);
          return;
        }
        await api.verifyDeliveryOtp(order.id, otp);
        toast.success(STATUS_EMOJI[action.next] ?? `Status updated to ${action.next}`);
        setOtpMode(false);
        setOtp('');
      } else {
        await api.updateOrderStatus(order.id, action.next);
        toast.success(STATUS_EMOJI[action.next] ?? `Status updated to ${action.next}`);
      }
      onUpdate();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rider-order-card ${order.is_emergency ? 'sos-pulse' : ''}`}>
      <div className="roc-top">
        <div>
          <div className="roc-id">
            #{order.id.slice(-6).toUpperCase()}
            {order.is_emergency && <span className="sos-badge" style={{ marginLeft: '8px' }}>🚨 SOS</span>}
          </div>
          <span className="roc-items"> · {order.orderItems?.length ?? 0} item(s) · ₹{total.toFixed(2)}</span>
        </div>
        <StatusBadge status={order.status} />
      </div>
      {order.pharmacy && <p className="roc-pharmacy">🏥 {order.pharmacy.name}</p>}
      <p className="roc-date">
        {new Date(order.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </p>
      
      {otpMode && (
        <div style={{ marginTop: '12px', marginBottom: '12px', background: 'var(--surface)', padding: '12px', borderRadius: 'var(--r-sm)' }}>
          <p style={{ color: 'var(--text)', fontSize: '14px', margin: '0 0 8px 0' }}>Ask the customer for their 6-digit Delivery OTP:</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="text" 
              className="input-field" 
              placeholder="000000" 
              value={otp} 
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              style={{ letterSpacing: '4px', fontSize: '18px', textAlign: 'center', flex: 1 }}
              maxLength={6}
            />
            <button className="btn-outline-sm" onClick={() => setOtpMode(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="roc-actions">
        <Link to={`/orders/${order.id}`} className="btn-outline-sm">View Details</Link>
        {action && (
          <button className={`btn-action ${action.cls}`} onClick={advance} disabled={busy}>
            {busy ? <span className="spinner-sm" /> : otpMode ? 'Submit OTP' : action.label}
          </button>
        )}
        {order.status === 'DELIVERED' && <span className="done-label">✅ Completed</span>}
        {order.status === 'CANCELLED'  && <span className="cancelled-label">❌ Cancelled</span>}
      </div>

      {order.delivery_lat != null && order.delivery_lng != null && order.pharmacy && ['ACCEPTED', 'OUT_FOR_DELIVERY'].includes(order.status) && (
        <div style={{ marginTop: '16px', height: '200px', borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--border)' }}>
          <MapContainer 
            center={[(order.delivery_lat + order.pharmacy.latitude) / 2, (order.delivery_lng + order.pharmacy.longitude) / 2]} 
            zoom={12} 
            scrollWheelZoom={false} 
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker position={[order.pharmacy.latitude, order.pharmacy.longitude]}>
              <Popup>🏥 Pickup: {order.pharmacy.name}</Popup>
            </Marker>
            <Marker position={[order.delivery_lat, order.delivery_lng]}>
              <Popup>📍 Drop-off</Popup>
            </Marker>
          </MapContainer>
        </div>
      )}
    </div>
  );
}

const POLL_MS = 30_000; // auto-refresh every 30 seconds

export function RiderDashboard() {
  const [orders,  setOrders]  = useState([]);
  const [filter,  setFilter]  = useState('available');
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const { user, logout } = useAuth();
  const toast    = useToast();
  const navigate = useNavigate();
  const timerRef = useRef(null);

  const load = useCallback((silent = false) => {
    return api.getOrders()
      .then(({ data }) => { setOrders(data); setLastSync(new Date()); })
      .catch(e => { if (!silent) toast.error('Failed to load orders: ' + e.message); })
      .finally(() => setLoading(false));
  }, [toast]);

  const isTracking = useRiderLocation(orders);

  // Initial load + polling
  useEffect(() => {
    void load(true);
    timerRef.current = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  const available = orders.filter(o => o.status === 'PENDING');
  const assigned  = orders.filter(o => ['ACCEPTED','OUT_FOR_DELIVERY'].includes(o.status));
  const completed = orders.filter(o => ['DELIVERED','CANCELLED'].includes(o.status));
  
  let shown;
  let title;
  if (filter === 'available') { shown = available; title = '📍 Available Pickups'; }
  else if (filter === 'assigned') { shown = assigned; title = '🛵 My Deliveries'; }
  else { shown = completed; title = '✅ Completed'; }

  return (
    <div className="dash-layout">
      <aside className="dash-sidebar">
        <div className="sidebar-brand">
          <span>💊</span>
          <span>Pharma<span className="brand-accent">Dash</span></span>
        </div>
        <nav className="sidebar-nav">
          <span className="sidebar-label">RIDER PORTAL</span>
          <button id="filter-available-btn" className={`sidebar-item ${filter === 'available' ? 'active' : ''}`} onClick={() => setFilter('available')}>
            <span>📍</span> Available Pickups
            {available.length > 0 && <span className="sidebar-badge">{available.length}</span>}
          </button>
          <button id="filter-assigned-btn" className={`sidebar-item ${filter === 'assigned' ? 'active' : ''}`} onClick={() => setFilter('assigned')}>
            <span>🛵</span> My Deliveries
            {assigned.length > 0 && <span className="sidebar-badge" style={{ background: 'var(--cyan)' }}>{assigned.length}</span>}
          </button>
          <button id="filter-completed-btn" className={`sidebar-item ${filter === 'completed' ? 'active' : ''}`} onClick={() => setFilter('completed')}>
            <span>✅</span> Completed
            {completed.length > 0 && <span className="sidebar-badge" style={{ background: 'var(--green)' }}>{completed.length}</span>}
          </button>
        </nav>
        <div className="sidebar-footer">
          {isTracking && (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', color: '#4ade80', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ width: '8px', height: '8px', background: '#4ade80', borderRadius: '50%', boxShadow: '0 0 8px #4ade80', animation: 'pulse 2s infinite' }}></span>
              Live Tracking
            </div>
          )}
          <div className="sidebar-user">
            <span className="user-dot" />
            <div>
              <p className="su-name">{user?.full_name}</p>
              <p className="su-role">Rider</p>
            </div>
          </div>
          <button id="rider-logout-btn" className="btn-outline-sm" onClick={() => { logout(); navigate('/auth'); }}>Sign out</button>
        </div>
      </aside>

      <main className="dash-main">
        <div className="dash-header">
          <div>
            <h1 className="dash-title">{title}</h1>
            <p className="dash-sub">
              {shown.length} order{shown.length !== 1 ? 's' : ''}
              {lastSync && <span className="sync-label"> · synced {lastSync.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>}
            </p>
          </div>
          <button id="refresh-orders-btn" className="btn-outline-sm" onClick={() => load()}>↻ Refresh</button>
        </div>

        {loading && <div className="page-center"><div className="spinner" /></div>}

        {!loading && shown.length === 0 && (
          <div className="empty-state">
            <span>{filter === 'available' ? '📭' : filter === 'assigned' ? '🎉' : '📭'}</span>
            <p>{filter === 'available' ? 'No new orders available' : filter === 'assigned' ? 'You have no active deliveries' : 'No completed orders yet'}</p>
          </div>
        )}

        {!loading && shown.length > 0 && (
          <div className="rider-order-list">
            {shown.map(order => <OrderRow key={order.id} order={order} onUpdate={() => load(true)} />)}
          </div>
        )}
      </main>
    </div>
  );
}
