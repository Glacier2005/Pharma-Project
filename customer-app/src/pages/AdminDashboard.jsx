import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { useAuth } from '../context/auth-context';
import { useToast } from '../context/toast-context';
import { useNavigate } from 'react-router-dom';

/* ── Stats Card ─────────────────────────────────────────────── */
function StatCard({ icon, label, value, color }) {
  return (
    <div className="stat-card" style={{ '--accent-c': `var(--${color})`, '--accent-dim': `var(--${color}-dim)` }}>
      <span className="stat-icon">{icon}</span>
      <div>
        <p className="stat-value">{value}</p>
        <p className="stat-label">{label}</p>
      </div>
    </div>
  );
}

function InventoryRow({ item, onSave }) {
  const [expanded, setExpanded] = useState(false);
  const [batches, setBatches] = useState(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const loadBatches = async () => {
    setLoading(true);
    try {
      const { inventory } = await api.getInventoryItem(item.id);
      setBatches(inventory.batches || []);
    } catch (e) {
      toast.error('Failed to load batches: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const low = item.stock_quantity < 20;

  return (
    <>
      <tr className={`inv-row ${low ? 'inv-low' : ''}`}>
        <td className="inv-name">
          <span className="inv-med-name">{item.medicine?.name}</span>
          <span className="inv-generic">{item.medicine?.generic_name}</span>
        </td>
        <td className="inv-pharmacy">{item.pharmacy?.name}</td>
        <td className="inv-price">₹{parseFloat(item.medicine?.price ?? 0).toFixed(2)}</td>
        <td className="inv-stock">
          <span className={`stock-val ${low ? 'low' : ''}`}>{item.stock_quantity}</span>
        </td>
        <td className="inv-actions">
          <button className="btn-edit" onClick={() => { if (!expanded && !batches) void loadBatches(); setExpanded(!expanded); }}>
            {expanded ? 'Hide Batches' : 'Manage Batches'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="inv-expanded-row">
          <td colSpan="5" className="p-0">
            <div className="batch-panel">
              {loading && <div className="spinner-sm" style={{ margin: '16px auto' }} />}
              {!loading && batches && (
                <BatchManager inventoryId={item.id} batches={batches} onSave={() => { loadBatches(); onSave(); }} />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function BatchManager({ inventoryId, batches, onSave }) {
  const [showAdd, setShowAdd] = useState(false);
  const [adjustingId, setAdjustingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const [newBatch, setNewBatch] = useState({ batchNumber: '', quantity: '', expiryDate: '' });
  const [adjust, setAdjust] = useState({ delta: '', transactionType: 'ADJUSTMENT' });

  const handleAdd = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addBatch(inventoryId, {
        batchNumber: newBatch.batchNumber,
        quantity: parseInt(newBatch.quantity, 10),
        expiryDate: new Date(newBatch.expiryDate).toISOString(),
      });
      toast.success('Batch added');
      setShowAdd(false);
      setNewBatch({ batchNumber: '', quantity: '', expiryDate: '' });
      onSave();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleAdjust = async (e, batchId) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.adjustBatchStock(batchId, {
        delta: parseInt(adjust.delta, 10),
        transactionType: adjust.transactionType,
      });
      toast.success('Stock adjusted');
      setAdjustingId(null);
      setAdjust({ delta: '', transactionType: 'ADJUSTMENT' });
      onSave();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="batch-manager">
      <div className="bm-header">
        <h4>Batch Inventory</h4>
        <button className="btn-outline-sm" onClick={() => setShowAdd(!showAdd)}>+ Add Batch</button>
      </div>

      {showAdd && (
        <form className="bm-form" onSubmit={handleAdd}>
          <input required placeholder="Batch #" value={newBatch.batchNumber} onChange={e => setNewBatch({ ...newBatch, batchNumber: e.target.value })} />
          <input required type="number" min="1" placeholder="Qty" value={newBatch.quantity} onChange={e => setNewBatch({ ...newBatch, quantity: e.target.value })} />
          <input required type="date" title="Expiry Date" value={newBatch.expiryDate} onChange={e => setNewBatch({ ...newBatch, expiryDate: e.target.value })} />
          <button type="submit" disabled={busy} className="btn-save">Save Batch</button>
          <button type="button" onClick={() => setShowAdd(false)} className="btn-cancel">Cancel</button>
        </form>
      )}

      {batches.length === 0 ? (
        <p className="bm-empty">No active batches.</p>
      ) : (
        <table className="bm-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Qty</th>
              <th>Expiry</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {batches.map(b => (
              <tr key={b.id}>
                <td>{b.batchNumber}</td>
                <td>{b.quantity}</td>
                <td>
                  {b.isLegacy ? (
                    <span className="badge-legacy">Legacy (Unknown)</span>
                  ) : (
                    new Date(b.expiryDate).toLocaleDateString('en-IN')
                  )}
                </td>
                <td>
                  {b.isLegacy ? '-' : (new Date(b.expiryDate) < new Date() ? <span className="badge-expired">Expired</span> : 'Active')}
                </td>
                <td>
                  {adjustingId === b.id ? (
                    <form className="bm-adjust-form" onSubmit={(e) => handleAdjust(e, b.id)}>
                      <input required type="number" placeholder="+/-" value={adjust.delta} onChange={e => setAdjust({ ...adjust, delta: e.target.value })} style={{ width: '60px' }} />
                      <select value={adjust.transactionType} onChange={e => setAdjust({ ...adjust, transactionType: e.target.value })}>
                        <option value="ADJUSTMENT">Adjust</option>
                        <option value="DAMAGED">Damaged</option>
                        <option value="EXPIRED">Expired</option>
                        <option value="RETURN">Return</option>
                      </select>
                      <button type="submit" disabled={busy} className="btn-save-sm">OK</button>
                      <button type="button" onClick={() => setAdjustingId(null)} className="btn-cancel-sm">X</button>
                    </form>
                  ) : (
                    <button className="btn-edit-sm" onClick={() => { setAdjustingId(b.id); setAdjust({ delta: '', transactionType: 'ADJUSTMENT' }); }}>Adjust</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Admin Dashboard ─────────────────────────────────────────── */
export function AdminDashboard() {
  const [selectedTab, setTab] = useState(null);
  const [error, setError] = useState('');
  const [orders,    setOrders]    = useState([]);
  const [inventory, setInventory] = useState([]);
  const [users,     setUsers]     = useState([]);
  const [statsData, setStatsData] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const loadOrders = useCallback(() =>
    api.getOrders({ limit: 50 }).then(({ data }) => setOrders(data)), []);

  const loadInventory = useCallback(() =>
    api.getInventory({ limit: 100 }).then(({ data }) => setInventory(data)), []);

  const loadUsers = useCallback(() =>
    api.getUsers({ limit: 50 }).then(({ data }) => setUsers(data)), []);

  const loadStats = useCallback(() =>
    api.getAdminStats().then(data => setStatsData(data)), []);

  useEffect(() => {
    Promise.all([loadOrders(), loadInventory(), ...(user?.role === 'ADMIN' ? [loadStats(), loadUsers()] : [])])
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadStats, loadOrders, loadInventory, loadUsers, user?.role]);

  const stats = {
    total:     orders.length,
    pending:   orders.filter(o => o.status === 'PENDING').length,
    delivered: orders.filter(o => o.status === 'DELIVERED').length,
    lowStock:  inventory.filter(i => i.stock_quantity < 20).length,
  };

  const isAdmin = user?.role === 'ADMIN';
  const tab = !isAdmin && (!selectedTab || ['overview', 'users'].includes(selectedTab)) ? 'orders' : (selectedTab || 'overview');

  const TAB_LABELS = { 
    ...(isAdmin ? { overview: '📊 Overview' } : {}),
    orders: '📋 Orders',
    inventory: '📦 Inventory',
    ...(isAdmin ? { users: '👥 Users' } : {})
  };


  return (
    <div className="dash-layout">
      {error && <p role="alert">{error}</p>}
      {/* Sidebar */}
      <aside className="dash-sidebar">
        <div className="sidebar-brand">
          <span>💊</span>
          <span>Pharma<span className="brand-accent">Dash</span></span>
        </div>
        <nav className="sidebar-nav">
          <span className="sidebar-label">ADMIN PORTAL</span>
          {Object.entries(TAB_LABELS).map(([key, label]) => (
            <button
              key={key}
              id={`admin-tab-${key}`}
              className={`sidebar-item ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
              {key === 'orders' && stats.pending > 0 && <span className="sidebar-badge">{stats.pending}</span>}
              {key === 'inventory' && stats.lowStock > 0 && <span className="sidebar-badge warn">{stats.lowStock}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="user-dot" />
            <div>
              <p className="su-name">{user?.full_name}</p>
              <p className="su-role">Admin</p>
            </div>
          </div>
          <button id="admin-logout-btn" className="btn-outline-sm" onClick={() => { logout(); navigate('/auth'); }}>Sign out</button>
        </div>
      </aside>

      {/* Main */}
      <main className="dash-main">
        {loading && <div className="page-center"><div className="spinner" /></div>}

        {/* Overview Tab */}
        {!loading && tab === 'overview' && statsData && (
          <div className="admin-section fade-in">
            <div className="section-header">
              <h2 className="section-title">Platform Analytics</h2>
              <button className="btn-outline-sm" onClick={() => { setLoading(true); loadStats().finally(() => setLoading(false)); }}>↻ Refresh</button>
            </div>
            
            {/* Top Level Metrics */}
            <div className="stats-row" style={{ marginBottom: '32px' }}>
              <StatCard icon="📈" label="Total Revenue"  value={`₹${statsData.revenue}`} color="green" />
              <StatCard icon="⏳" label="Active Orders"  value={statsData.activeOrdersCount} color="amber" />
              <StatCard icon="⭐" label="Platform Rating" value={`${statsData.avgRating?.toFixed(1) || '0.0'}/5.0`} color="cyan" />
              <StatCard icon="🛵" label="Riders Online"  value={statsData.demographics?.RIDER || 0} color="purple" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {/* Recent Activity */}
              <div className="data-panel" style={{ background: 'var(--surface)', padding: '20px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                <h3 style={{ color: 'var(--text)', marginBottom: '16px', fontSize: '16px' }}>Recent Activity</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {statsData.recentOrders?.map(order => (
                    <div key={order.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg)', borderRadius: 'var(--r-sm)' }}>
                      <div>
                        <p style={{ color: 'var(--white)', margin: '0 0 4px', fontSize: '14px', fontWeight: 500 }}>{order.customer} <span style={{ color: 'var(--text2)', fontWeight: 400 }}>ordered</span></p>
                        <p style={{ color: 'var(--text2)', margin: 0, fontSize: '12px' }}>{new Date(order.createdAt).toLocaleTimeString()} • ₹{order.amount}</p>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                  ))}
                  {statsData.recentOrders?.length === 0 && <p style={{ color: 'var(--text2)', fontSize: '14px' }}>No recent orders.</p>}
                </div>
              </div>

              {/* Operational Alerts */}
              <div className="data-panel" style={{ background: 'var(--surface)', padding: '20px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)' }}>
                <h3 style={{ color: 'var(--text)', marginBottom: '16px', fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--red)' }}>⚠</span> Low Stock Alerts
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {statsData.lowStockItems?.map(item => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'var(--bg)', borderRadius: 'var(--r-sm)', borderLeft: '3px solid var(--red)' }}>
                      <div>
                        <p style={{ color: 'var(--white)', margin: '0 0 4px', fontSize: '14px', fontWeight: 500 }}>{item.medicine}</p>
                        <p style={{ color: 'var(--text2)', margin: 0, fontSize: '12px' }}>{item.pharmacy}</p>
                      </div>
                      <span style={{ color: 'var(--red)', fontWeight: 'bold', fontSize: '14px', background: 'var(--red-dim)', padding: '4px 8px', borderRadius: '12px' }}>
                        {item.stock} left
                      </span>
                    </div>
                  ))}
                  {statsData.lowStockItems?.length === 0 && <p style={{ color: 'var(--text2)', fontSize: '14px' }}>All inventory levels are healthy.</p>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Orders Tab */}
        {!loading && tab === 'orders' && (
          <div className="admin-section">
            <div className="section-header">
              <h2 className="section-title">All Orders</h2>
              <button id="refresh-admin-orders-btn" className="btn-outline-sm" onClick={() => { setLoading(true); loadOrders().finally(() => setLoading(false)); }}>↻ Refresh</button>
            </div>
            <div className="orders-list">
              {orders.map(order => {
                const total = order.orderItems?.reduce((s, i) => s + parseFloat(i.unit_price) * i.quantity, 0) ?? 0;
                return (
                  <div key={order.id} className={`order-card admin-order-card ${order.is_emergency ? 'sos-pulse' : ''}`}>
                    <div className="order-card-top">
                      <span className="order-id">
                        #{order.id.slice(-8).toUpperCase()}
                        {order.is_emergency && <span className="sos-badge" style={{ marginLeft: '8px' }}>🚨 SOS</span>}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="order-card-meta">
                      <span>{order.orderItems?.length ?? 0} item(s)</span>
                      <span className="order-total">₹{total.toFixed(2)}</span>
                      {order.pharmacy && <span>🏥 {order.pharmacy.name}</span>}
                      <span className="order-date">{new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Inventory Tab */}
        {!loading && tab === 'inventory' && (
          <div className="admin-section">
            <div className="section-header">
              <h2 className="section-title">Inventory Management</h2>
              <button id="refresh-inventory-btn" className="btn-outline-sm" onClick={() => { setLoading(true); loadInventory().finally(() => setLoading(false)); }}>↻ Refresh</button>
            </div>
            {stats.lowStock > 0 && (
              <div className="low-stock-banner">
                ⚠ {stats.lowStock} item{stats.lowStock !== 1 ? 's' : ''} running low on stock
              </div>
            )}
            <div className="table-wrap">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Pharmacy</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map(item => (
                    <InventoryRow key={item.id} item={item} onSave={() => { setLoading(true); loadInventory().finally(() => setLoading(false)); }} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {!loading && tab === 'users' && (
          <div className="admin-section">
            <h2 className="section-title">User Management</h2>
            <div className="table-wrap">
              <table className="inv-table">
                <thead>
                  <tr><th>Name</th><th>Phone</th><th>Role</th><th>Orders</th><th>Joined</th></tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="inv-row">
                      <td className="inv-name"><span className="inv-med-name">{u.full_name}</span></td>
                      <td style={{ color: 'var(--text2)', fontSize: '13px' }}>{u.phone_number}</td>
                      <td><span className={`role-badge role-${u.role.toLowerCase()}`}>{u.role}</span></td>
                      <td style={{ color: 'var(--cyan)', fontWeight: 600 }}>{u._count?.orders ?? 0}</td>
                      <td style={{ color: 'var(--text)', fontSize: '13px' }}>{new Date(u.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
