import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Navbar } from '../components/Navbar';
import { MedicineCard } from '../components/MedicineCard';
import { SkeletonCard } from '../components/SkeletonCard';
import { CartDrawer } from '../components/CartDrawer';
import { ScanModal } from '../components/ScanModal';
import { inferCategory, CATEGORIES, CATEGORY_ICONS } from '../lib/medicine';

const FREE_DELIVERY_THRESHOLD = 499;

export function HomePage() {
  const [medicines, setMedicines] = useState([]);
  const [query,     setQuery]     = useState('');
  const [category,  setCategory]  = useState('All');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [showScan,  setShowScan]  = useState(false);

  useEffect(() => {
    api.getMedicines()
      .then(({ medicines }) => setMedicines(medicines))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = medicines.filter(m => {
    const q = query.toLowerCase();
    const matchQuery = !q || m.name.toLowerCase().includes(q) || m.generic_name.toLowerCase().includes(q);
    const matchCat   = category === 'All' || inferCategory(m) === category;
    return matchQuery && matchCat;
  });

  // Which categories actually have medicines?
  const activeCats = ['All', ...new Set(medicines.map(inferCategory))];

  return (
    <div className="app-layout">
      <Navbar />
      <CartDrawer />
      <ScanModal isOpen={showScan} onClose={() => setShowScan(false)} />

      <main className="main-content">
        {/* Search hero banner */}
        <div className="search-hero">
          <div className="search-hero-inner">
            <h1 className="search-hero-title">Your health, delivered fast 💊</h1>
            <p className="search-hero-sub">Search from 500+ medicines — delivered in under 60 min</p>
            <div className="search-bar-lg">
              <span className="search-icon-lg">🔍</span>
              <input
                id="medicine-search"
                className="search-input-lg"
                type="search"
                placeholder="Search medicines, generics..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                autoComplete="off"
              />
              {query && (
                <button className="search-clear" onClick={() => setQuery('')}>✕</button>
              )}
            </div>
            <button className="btn-scan-presc" onClick={() => setShowScan(true)}>
              <span>📸</span> Scan Prescription with AI
            </button>
          </div>
        </div>

        {/* Free delivery banner */}
        <div className="delivery-banner">
          <span>🚀</span>
          <span><strong>Free delivery</strong> on orders above ₹{FREE_DELIVERY_THRESHOLD}</span>
          <span className="db-pill">⚡ In 45 min</span>
        </div>

        {/* Category pills */}
        <div className="category-scroll">
          {CATEGORIES.filter(c => activeCats.includes(c)).map(cat => (
            <button
              key={cat}
              className={`cat-pill ${category === cat ? 'active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              <span className="cat-pill-icon">{CATEGORY_ICONS[cat]}</span>
              {cat}
            </button>
          ))}
        </div>

        {/* Skeleton loading */}
        {loading && (
          <div className="medicine-grid">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {error && (
          <div className="error-state">
            <p>⚠ {error}</p>
            <button className="btn-outline" onClick={() => window.location.reload()}>Retry</button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="results-bar">
              <p className="results-count">
                {filtered.length} medicine{filtered.length !== 1 ? 's' : ''}
                {category !== 'All' && <span className="active-filter"> in {category}</span>}
                {query && <span className="active-filter"> for "{query}"</span>}
              </p>
              {(query || category !== 'All') && (
                <button className="clear-filters" onClick={() => { setQuery(''); setCategory('All'); }}>
                  Clear filters ✕
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="empty-state">
                <span>🔬</span>
                <p>No medicines found</p>
                <button className="btn-outline" onClick={() => { setQuery(''); setCategory('All'); }}>
                  Show all medicines
                </button>
              </div>
            ) : (
              <div className="medicine-grid">
                {filtered.map(m => <MedicineCard key={m.id} medicine={m} />)}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
