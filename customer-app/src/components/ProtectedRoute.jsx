import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';

import { SplashScreen } from './SplashScreen';

export function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <SplashScreen />;
  if (!user)   return <Navigate to="/auth" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}
