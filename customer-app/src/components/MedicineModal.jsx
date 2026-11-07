import { useState } from 'react';
import { useCart } from '../context/cart-context';
import { useToast } from '../context/toast-context';
import { inferCategory, getMedicineDetails, getMedicineRating, CATEGORY_ICONS } from '../lib/medicine';

const TABS = ['Details', 'Usage', 'Side Effects'];

export function MedicineModal({ medicine, onClose }) {
  const [tab, setTab]       = useState('Details');
  const { addItem, items, setOpen: openCart } = useCart();
  const toast  = useToast();
  const inCart = items.find(i => i.medicine.id === medicine.id);
  const outOfStock = medicine.stock_quantity === 0;
  const cat    = inferCategory(medicine);
  const details = getMedicineDetails(medicine);
  const { rating, reviews } = getMedicineRating(medicine);

  function handleAdd() {
    addItem(medicine);
    toast.success(`${medicine.name} added to cart!`);
    onClose();
  }

  function handleGoCart() {
    onClose();
    openCart(true);
  }

  const stars = Math.round(parseFloat(rating));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {/* Header */}
        <div className="modal-header">
          <div className="modal-icon-wrap">
            <span className="modal-cat-icon">{CATEGORY_ICONS[cat] ?? '💊'}</span>
          </div>
          <div className="modal-title-block">
            <div className="modal-badges">
              <span className="cat-badge">{cat}</span>
              {medicine.requires_prescription && <span className="rx-badge">Rx Required</span>}
            </div>
            <h2 className="modal-name">{medicine.name}</h2>
            <p className="modal-generic">{medicine.generic_name}</p>
            <div className="modal-rating">
              <span className="stars">{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
              <span className="rating-val">{rating}</span>
              <span className="rating-ct">({reviews} reviews)</span>
            </div>
          </div>
        </div>

        {/* Price bar */}
        <div className="modal-price-bar">
          <div>
            <span className="modal-price">₹{parseFloat(medicine.price).toFixed(2)}</span>
            <span className="modal-mrp"> MRP ₹{(parseFloat(medicine.price) * 1.15).toFixed(2)}</span>
            <span className="modal-discount"> 13% off</span>
          </div>
          <span className={`stock-pill ${outOfStock ? 'oos' : medicine.stock_quantity < 20 ? 'low' : 'ok'}`}>
            {outOfStock ? '❌ Out of stock' : medicine.stock_quantity < 20 ? `⚡ Only ${medicine.stock_quantity} left` : '✅ In stock'}
          </span>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          {TABS.map(t => (
            <button key={t} className={`modal-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {/* Tab content */}
        <div className="modal-content">
          {tab === 'Details' && (
            <dl className="detail-list">
              <div className="dl-row"><dt>Composition</dt><dd>{details.composition}</dd></div>
              <div className="dl-row"><dt>Manufacturer</dt><dd>{details.manufacturer}</dd></div>
              <div className="dl-row"><dt>Category</dt><dd>{cat}</dd></div>
              <div className="dl-row"><dt>Storage</dt><dd>Store below 25°C, away from moisture and sunlight.</dd></div>
              <div className="dl-row"><dt>Prescription</dt><dd>{medicine.requires_prescription ? '⚠ Required' : 'Not required'}</dd></div>
            </dl>
          )}
          {tab === 'Usage' && (
            <div className="tab-prose">
              <h4>How to take</h4>
              <p>{details.usage}</p>
              <h4>Precautions</h4>
              <p>{details.precautions}</p>
            </div>
          )}
          {tab === 'Side Effects' && (
            <div className="tab-prose">
              <h4>Common side effects</h4>
              <p>{details.sideEffects}</p>
              <div className="se-note">
                <span>ℹ️</span>
                <span>This is not a complete list. Consult your doctor if you experience any unusual symptoms.</span>
              </div>
            </div>
          )}
        </div>

        {/* CTA */}
        <div className="modal-cta">
          {outOfStock ? (
            <button className="btn-primary btn-full" disabled>Out of Stock</button>
          ) : inCart ? (
            <button id="go-to-cart-btn" className="btn-primary btn-full" onClick={handleGoCart}>
              Go to Cart ({inCart.quantity} added) →
            </button>
          ) : (
            <button id="add-to-cart-modal-btn" className="btn-primary btn-full" onClick={handleAdd}>
              🛒 Add to Cart — ₹{parseFloat(medicine.price).toFixed(2)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
