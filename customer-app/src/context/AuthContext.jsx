import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';

import { AuthCtx } from './auth-context';

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('pd_token')));

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem('pd_token');
      setUser(null);
    };
    window.addEventListener('unauthorized', handleUnauthorized);
    return () => window.removeEventListener('unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('pd_token');
    if (!token) return;
    api.getMe()
      .then(({ user }) => setUser(user))
      .catch((e) => console.error('Failed to load user:', e.message))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (phone_number, password) => {
    const { user, token } = await api.login({ phone_number, password });
    localStorage.setItem('pd_token', token);
    setUser(user);
  }, []);

  const register = useCallback(async (phone_number, full_name, password, role = 'CUSTOMER') => {
    const { user, token } = await api.register({ phone_number, full_name, password, role });
    localStorage.setItem('pd_token', token);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('pd_token');
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
