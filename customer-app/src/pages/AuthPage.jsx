import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/auth-context';

export function AuthPage() {
  const [tab, setTab]       = useState('login');
  const [phone, setPhone]   = useState('');
  const [name, setName]     = useState('');
  const [pass, setPass]     = useState('');
  const [error, setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await login(phone, pass);
      } else {
        if (!name.trim()) { setError('Full name is required'); setLoading(false); return; }
        await register(phone, name, pass);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-bg" />
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-logo">💊</span>
          <h1 className="auth-title">PharmaDash</h1>
          <p className="auth-sub">Fast pharmacy delivery at your doorstep</p>
        </div>

        <div className="auth-tabs">
          <button
            id="login-tab-btn"
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); }}
          >Sign In</button>
          <button
            id="register-tab-btn"
            className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setError(''); }}
          >Create Account</button>
        </div>

        <form id="auth-form" className="auth-form" onSubmit={handleSubmit}>
          {tab === 'register' && (
            <>
              <div className="field">
                <label htmlFor="full-name">Full Name</label>
                <input
                  id="full-name"
                  type="text"
                  placeholder="Alex Rivera"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>

            </>
          )}

          <div className="field">
            <label htmlFor="phone">Phone Number</label>
            <input
              id="phone"
              type="tel"
              placeholder="+15550100001"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={pass}
              onChange={e => setPass(e.target.value)}
              required
            />
          </div>

          {error && <p className="form-error">⚠ {error}</p>}

          <button id="auth-submit-btn" className="btn-primary btn-full" type="submit" disabled={loading}>
            {loading
              ? <span className="spinner-sm" />
              : tab === 'login' ? 'Sign In →' : 'Create Account →'}
          </button>
        </form>

        {tab === 'login' && (
          <p className="auth-hint">
            Demo: <code>+15550100001</code> / <code>customer123</code>
          </p>
        )}
      </div>
    </div>
  );
}
