import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Navbar } from '../components/Navbar';
import { CartDrawer } from '../components/CartDrawer';
import { StatusBadge } from '../components/StatusBadge';
import { useCart } from '../context/cart-context';
import { useToast } from '../context/toast-context';

function ReorderButton({ order }) {
  const { addItem, setOpen } = useCart();
  const toast = useToast();
  const [done, setDone] = useState(false);

  function handleReorder(e) {
    e.preventDefault();
    if (!order.orderItems?.length) return;
    order.orderItems.forEach(item => {
      if (item.medicine) addItem({ ...item.medicine, id: item.medicineId || item.medicine.id, price: item.medicine.price ?? item.unit_price }, item.quantity);
    });
    setDone(true);
    setOpen(true);
    toast.success('Items added to cart! 🛒');
  }

  return (
    <button
      className={`btn-reorder ${done ? 'done' : ''}`}
      onClick={handleReorder}
      disabled={done}
    >
      {done ? '✓ Added to cart' : '🔄 Reorder'}
    </button>
  );
}

export function OrdersPage() {
  const [orders,  setOrders]  = useState([]);
  const [filter,  setFilter]  = useState('all');
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.getOrders()
      .then(({ data }) => setOrders(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const FILTERS = [
    { key: 'all',     label: 'All Orders' },
    { key: 'active',  label: '⏳ Active' },
    { key: 'done',    label: '✅ Delivered' },
  ];

  const shown = orders.filter(o => {
    if (filter === 'active') return ['PRESCRIPTION_PENDING','PAYMENT_PENDING','PENDING','ACCEPTED','OUT_FOR_DELIVERY'].includes(o.status);
    if (filter === 'done')   return o.status === 'DELIVERED';
    return true;
  });

  return (
    <div className="app-layout">
      <Navbar />
      <CartDrawer />

      <main className="main-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">My Orders</h1>
            <p className="page-sub">{orders.length} order{orders.length !== 1 ? 's' : ''} placed</p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="order-filter-tabs">
          {FILTERS.map(f => (
            <button key={f.key} className={`ofilter-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="orders-list">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="order-card skel-order">
                <div className="skel-line skel-pulse" style={{ width: '40%', height: 16 }} />
                <div className="skel-line skel-pulse" style={{ width: '60%', height: 13, marginTop: 10 }} />
              </div>
            ))}
          </div>
        )}

        {error && <div className="error-state"><p>⚠ {error}</p></div>}

        {!loading && !error && shown.length === 0 && (
          <div className="empty-state">
            <span>📦</span>
            <p>{filter === 'all' ? 'No orders yet' : `No ${filter} orders`}</p>
            <Link to="/medicines" className="btn-primary">Browse Medicines</Link>
          </div>
        )}

        {!loading && !error && shown.length > 0 && (
          <div className="orders-list">
            {shown.map(order => {
              const total = Number(order.total_amount ?? 0);
              const isActive = ['PENDING','ACCEPTED','OUT_FOR_DELIVERY'].includes(order.status);
              return (
                <Link key={order.id} to={`/orders/${order.id}`} className="order-card">
                  <div className="order-card-top">
                    <div>
                      <span className="order-id">#{order.id.slice(-8).toUpperCase()}</span>
                      {isActive && <span className="order-live-dot" title="Live order" />}
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="order-card-items">
                    {order.orderItems?.slice(0, 3).map(i => (
                      <span key={i.id} className="order-item-chip">💊 {i.medicine?.name ?? 'Medicine'} ×{i.quantity}</span>
                    ))}
                    {(order.orderItems?.length ?? 0) > 3 && (
                      <span className="order-item-chip more">+{order.orderItems.length - 3} more</span>
                    )}
                  </div>
                  <div className="order-card-meta">
                    <span className="order-total">₹{total.toFixed(2)}</span>
                    <span className="order-date">
                      {new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {order.status === 'DELIVERED' && (
                      <ReorderButton order={order} />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
