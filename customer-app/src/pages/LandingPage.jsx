import { Link } from 'react-router-dom';
import { useAuth } from '../context/auth-context';

const FEATURES = [
  { icon: '🚀', title: 'Fast Delivery', desc: 'Same-day delivery from the nearest pharmacy to your door.' },
  { icon: '💊', title: '500+ Medicines', desc: 'Full catalogue of prescription and OTC medicines always available.' },
  { icon: '🔒', title: 'Secure & Private', desc: 'Your health data is encrypted and never shared with third parties.' },
  { icon: '📍', title: 'Live Tracking', desc: 'Watch your order move from pharmacy to your doorstep in real time.' },
  { icon: '🩺', title: 'Rx Support', desc: 'Upload prescriptions and get dispensing handled automatically.' },
  { icon: '💳', title: 'Easy Checkout', desc: 'One-tap cart checkout — no account details needed every time.' },
];

const STEPS = [
  { n: '01', title: 'Browse & Add', desc: 'Search our full medicine catalogue and add what you need to your cart.' },
  { n: '02', title: 'Place Order',  desc: 'Checkout in seconds — our system finds the nearest stocked pharmacy.' },
  { n: '03', title: 'Get Delivered', desc: 'A rider picks up your order and delivers it straight to your door.' },
];

export function LandingPage() {
  const { user } = useAuth();

  const ctaHref = user
    ? (user.role === 'RIDER' ? '/rider' : user.role === 'ADMIN' ? '/admin' : '/medicines')
    : '/auth';
  const ctaLabel = user ? 'Go to Dashboard →' : 'Order Medicines Now →';

  return (
    <div className="landing">

      {/* ── Nav ── */}
      <header className="landing-nav">
        <div className="ln-inner">
          <span className="brand-name">💊 Pharma<span className="brand-accent">Dash</span></span>
          <nav className="ln-links">
            <a href="#features" className="ln-link">Features</a>
            <a href="#how" className="ln-link">How it works</a>
          </nav>
          <Link id="landing-cta-nav" to={ctaHref} className="btn-primary btn-sm">
            {user ? 'Dashboard' : 'Sign In'}
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="hero-section">
        <div className="hero-glow" />
        <div className="hero-inner">
          <div className="hero-badge">🏥 Trusted by 10,000+ customers</div>
          <h1 className="hero-title">
            Pharmacy delivery,<br />
            <span className="gradient-text">at lightning speed</span>
          </h1>
          <p className="hero-sub">
            Order prescription and OTC medicines from your nearest pharmacy.
            Delivered to your door in under 60 minutes.
          </p>
          <div className="hero-actions">
            <Link id="hero-cta-btn" to={ctaHref} className="btn-hero">
              {ctaLabel}
            </Link>
            <a href="#how" className="btn-hero-ghost">See how it works</a>
          </div>
          <div className="hero-stats">
            <div className="hero-stat"><strong>60 min</strong><span>avg delivery</span></div>
            <div className="hero-stat-divider" />
            <div className="hero-stat"><strong>500+</strong><span>medicines</span></div>
            <div className="hero-stat-divider" />
            <div className="hero-stat"><strong>24/7</strong><span>available</span></div>
          </div>
        </div>

        {/* Floating medicine cards */}
        <div className="hero-cards" aria-hidden="true">
          {['💊 Amoxicillin', '🩺 Omeprazole', '💉 Ibuprofen', '🧬 Loratadine'].map((m, i) => (
            <div key={i} className="float-card" style={{ animationDelay: `${i * 0.4}s` }}>
              <span>{m.split(' ')[0]}</span>
              <span className="fc-name">{m.split(' ')[1]}</span>
              <span className="fc-badge">In stock</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="features-section">
        <div className="section-container">
          <div className="section-tag">Why PharmaDash</div>
          <h2 className="section-heading">Everything you need,<br />nothing you don't</h2>
          <div className="features-grid">
            {FEATURES.map(f => (
              <div key={f.title} className="feature-card">
                <span className="feature-icon">{f.icon}</span>
                <h3 className="feature-title">{f.title}</h3>
                <p className="feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="how-section">
        <div className="section-container">
          <div className="section-tag">Simple process</div>
          <h2 className="section-heading">Medicine in 3 steps</h2>
          <div className="steps-row">
            {STEPS.map((s, i) => (
              <div key={s.n} className="step-card">
                <div className="step-num">{s.n}</div>
                <h3 className="step-title">{s.title}</h3>
                <p className="step-desc">{s.desc}</p>
                {i < STEPS.length - 1 && <div className="step-arrow">→</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section className="cta-section">
        <div className="cta-glow" />
        <div className="section-container cta-inner">
          <h2 className="cta-heading">Ready to get started?</h2>
          <p className="cta-sub">Join thousands of customers who trust PharmaDash for their medicine needs.</p>
          <Link id="cta-final-btn" to={ctaHref} className="btn-hero">{ctaLabel}</Link>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="ln-inner">
          <span className="brand-name" style={{ fontSize: '15px' }}>💊 PharmaDash</span>
          <span className="footer-copy">© 2025 PharmaDash. Fast. Reliable. Trusted.</span>
        </div>
      </footer>

    </div>
  );
}
