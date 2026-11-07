import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/auth-context';
import { useCart } from '../context/cart-context';

export function Navbar() {
  const { user, logout } = useAuth();
  const { count, setOpen } = useCart();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="brand">
          <span className="brand-pill">💊</span>
          <span className="brand-name">Pharma<span className="brand-accent">Dash</span></span>
        </Link>

        <div className="nav-links">
                  <Link to="/medicines" className={`nav-link ${pathname === '/medicines' ? 'active' : ''}`}>Medicines</Link>
          <Link to="/orders" className={`nav-link ${pathname.startsWith('/orders') ? 'active' : ''}`}>My Orders</Link>
        </div>

        <div className="nav-actions">
          {user && (
            <span className="nav-user">
              <span className="user-dot" />
              {user.full_name.split(' ')[0]}
            </span>
          )}
          <button id="cart-toggle-btn" className="cart-btn" onClick={() => setOpen(true)} aria-label="Open cart">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.3 2.3c-.6.6-.2 1.7.7 1.7H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            {count > 0 && <span className="cart-badge">{count}</span>}
          </button>
          <button id="logout-btn" className="btn-outline-sm" onClick={() => { logout(); navigate('/auth'); }}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
