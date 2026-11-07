import { useState } from 'react';
import { useCart } from '../context/cart-context';
import { useToast } from '../context/toast-context';
import { inferCategory, getMedicineRating, CATEGORY_ICONS } from '../lib/medicine';
import { MedicineModal } from './MedicineModal';

export function MedicineCard({ medicine }) {
  const { addItem, items, setOpen: openCart } = useCart();
  const toast = useToast();
  const [showModal, setShowModal] = useState(false);

  const inCart     = items.find(i => i.medicine.id === medicine.id);
  const outOfStock = medicine.stock_quantity === 0;
  const lowStock   = !outOfStock && medicine.stock_quantity < 20;
  const cat        = inferCategory(medicine);
  const icon       = CATEGORY_ICONS[cat] ?? '💊';
  const { rating, reviews } = getMedicineRating(medicine);
  const stars      = Math.round(parseFloat(rating));
  const price      = parseFloat(medicine.price);
  const mrp        = (price * 1.15).toFixed(2);

  function handleAdd(e) {
    e.stopPropagation();
    addItem(medicine);
    toast.success(`${medicine.name} added! 🛒`);
  }

  return (
    <>
      <article
        className={`med-card ${outOfStock ? 'oos' : ''}`}
        onClick={() => setShowModal(true)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setShowModal(true)}
      >
        {/* Top badges */}
        <div className="med-card-top">
          <span className="cat-chip">{cat}</span>
          <div className="med-badges">
            {medicine.requires_prescription && <span className="rx-badge">Rx</span>}
            {lowStock && <span className="low-badge">⚡ {medicine.stock_quantity} left</span>}
            {!outOfStock && !lowStock && <span className="disc-badge">13% off</span>}
          </div>
        </div>

        {/* Icon area */}
        <div className="med-icon-area">
          <span className="med-icon-lg">{icon}</span>
        </div>

        {/* Body */}
        <div className="med-body">
          <h3 className="med-name">{medicine.name}</h3>
          <p className="med-generic">{medicine.generic_name}</p>
          <div className="med-rating">
            <span className="stars-sm">{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
            <span className="rating-num">{rating}</span>
            <span className="rating-reviews">({reviews})</span>
          </div>
        </div>

        {/* Footer */}
        <div className="med-footer">
          <div className="price-block">
            <span className="med-price">₹{price.toFixed(2)}</span>
            <span className="med-mrp">₹{mrp}</span>
          </div>

          {outOfStock ? (
            <button className="btn-add" disabled onClick={e => e.stopPropagation()}>Unavailable</button>
          ) : inCart ? (
            <button className="btn-add in-cart" onClick={e => { e.stopPropagation(); openCart(true); }}>
              In cart ✓
            </button>
          ) : (
            <button className="btn-add" onClick={handleAdd}>+ Add</button>
          )}
        </div>

        <p className="card-tap-hint">Tap for details</p>
      </article>

      {showModal && <MedicineModal medicine={medicine} onClose={() => setShowModal(false)} />}
    </>
  );
}
