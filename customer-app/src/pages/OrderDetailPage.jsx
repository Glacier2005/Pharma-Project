import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { Navbar } from '../components/Navbar';
import { CartDrawer } from '../components/CartDrawer';
import { StatusBadge } from '../components/StatusBadge';
import { TrackingScreen } from '../App.jsx';
import { useToast } from '../context/toast-context';

const STEPS = ['PRESCRIPTION_PENDING', 'PAYMENT_PENDING', 'PENDING', 'ACCEPTED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const STEP_LABELS = { PRESCRIPTION_PENDING: 'Prescription', PAYMENT_PENDING: 'Payment', PENDING: 'Order Placed', ACCEPTED: 'Accepted', OUT_FOR_DELIVERY: 'On the Way', DELIVERED: 'Delivered' };

function FeedbackCard({ orderId, existingRating, existingFeedback, onSubmitted }) {
  const [rating, setRating] = useState(existingRating || 0);
  const [hover, setHover]   = useState(0);
  const [text, setText]     = useState(existingFeedback || '');
  const [busy, setBusy]     = useState(false);
  const toast = useToast();

  if (existingRating && !busy) {
    return (
      <div className="od-section feedback-card-submitted">
        <h2 className="od-section-title">Your Feedback</h2>
        <div className="feedback-content">
          <div className="stars-static">
            {[1,2,3,4,5].map(s => <span key={s} className="star-static">{s <= existingRating ? '⭐' : '☆'}</span>)}
          </div>
          {existingFeedback && <p className="feedback-text">"{existingFeedback}"</p>}
        </div>
      </div>
    );
  }

  async function submit() {
    if (rating === 0) {
      toast.error('Please select a rating');
      return;
    }
    setBusy(true);
    try {
      await api.submitFeedback(orderId, { rating, feedback: text });
      toast.success('Feedback submitted! Thank you.');
      onSubmitted();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="od-section feedback-card">
      <h2 className="od-section-title">Rate your Experience</h2>
      <div className="feedback-form">
        <p style={{ color: 'var(--text2)', marginBottom: '12px', fontSize: '14px' }}>How was your delivery experience?</p>
        <div className="stars-input">
          {[1,2,3,4,5].map(s => (
            <button
              key={s}
              className={`star-btn ${(hover || rating) >= s ? 'active' : ''}`}
              onClick={() => setRating(s)}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(0)}
            >
              ⭐
            </button>
          ))}
        </div>
        <textarea
          className="input-field"
          placeholder="Optional: Tell us what went well or what we can improve..."
          value={text}
          onChange={e => setText(e.target.value)}
          style={{ marginTop: '16px', minHeight: '80px', fontSize: '14px' }}
        />
        <button className="btn-primary" onClick={submit} disabled={busy || rating === 0} style={{ marginTop: '16px', width: '100%' }}>
          {busy ? <span className="spinner-sm" /> : 'Submit Feedback'}
        </button>
      </div>
    </div>
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  const [order,   setOrder]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [uploadingRx, setUploadingRx] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [rxFile, setRxFile] = useState(null);
  const [hasUploadedRx, setHasUploadedRx] = useState(() => localStorage.getItem(`rx_uploaded_${id}`) === 'true');
  const toast = useToast();

  const fetchOrder = useCallback(() => api.getOrder(id)
    .then(({ order: data }) => { setOrder(data); setError(''); return data; })
    .catch(e => { setError(e.message); return null; })
    .finally(() => setLoading(false)), [id]);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  const status = order?.status;
  useEffect(() => {
    if (!status || ['DELIVERED', 'CANCELLED'].includes(status)) return;
    const timer = setInterval(() => void fetchOrder(), 5000);
    return () => clearInterval(timer);
  }, [status, fetchOrder]);

  const total = Number(order?.total_amount ?? 0);

  const stepIdx    = order ? STEPS.indexOf(order.status) : -1;
  const isCancelled = order?.status === 'CANCELLED';

  async function handleRxUpload(e) {
    if (e.target.files && e.target.files[0]) {
      setRxFile(e.target.files[0]);
    }
  }

  async function submitRxUpload() {
    if (!rxFile) return;
    
    setUploadingRx(true);
    const formData = new FormData();
    formData.append('prescription', rxFile);

    try {
      await api.uploadPrescription(order.id, formData);
      toast.success('Prescription uploaded successfully!');
      localStorage.setItem(`rx_uploaded_${order.id}`, 'true');
      setHasUploadedRx(true);
      setRxFile(null);
      await fetchOrder();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploadingRx(false);
    }
  }

  const [confirmingPayment, setConfirmingPayment] = useState(false);

  function loadRazorpayScript() {
    return new Promise((resolve) => {
      if (window.Razorpay) { resolve(true); return; }
      
      let script = document.getElementById('razorpay-checkout-js');
      if (script) { script.remove(); }
      
      script = document.createElement('script');
      script.id = 'razorpay-checkout-js';
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => {
        script.remove();
        resolve(false);
      };
      document.body.appendChild(script);
    });
  }

  async function handlePayment(method = 'RAZORPAY') {
    setProcessingPayment(true);
    setConfirmingPayment(false);
    try {
      // 1. Call backend — backend calculates authoritative amount from DB
      const checkoutData = await api.processPayment(order.id, { method });

      // 2. Local/COD mode: backend already transitioned the order
      if (!checkoutData.razorpayOrderId) {
        toast.success('Payment processed successfully!');
        const { order: updated } = await api.getOrder(order.id);
        setOrder(updated);
        return;
      }

      // 3. Razorpay mode: load SDK and open checkout
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast.error('Failed to load payment gateway. Please try again.');
        return;
      }

      await new Promise((resolve, reject) => {
        const options = {
          key: checkoutData.keyId,              // Only KEY_ID, never the secret
          amount: checkoutData.amount,          // In paise, from DB
          currency: checkoutData.currency,
          order_id: checkoutData.razorpayOrderId,
          name: 'PharmaDash',
          description: `Order #${order.id.slice(-8).toUpperCase()}`,
          theme: { color: '#00bfad' },
          handler: () => {
            // Frontend callback fires — but we do NOT trust it for final state
            // Instead we show confirming state and poll the backend
            setConfirmingPayment(true);
            resolve(null);
          },
          modal: {
            ondismiss: () => {
              // User closed without paying
              reject(new Error('Payment cancelled'));
            }
          }
        };

        if (typeof window.Razorpay !== 'function') {
          reject(new Error("Your browser's adblocker is preventing the payment gateway from loading. Please disable Brave Shields or your adblocker for this site."));
          return;
        }

        const rzp = new window.Razorpay(options);
        rzp.open();
      });

      // 4. Poll backend until order leaves PAYMENT_PENDING (max ~2 min)
      toast.info('Payment submitted — confirming payment...');
      let attempts = 0;
      const maxAttempts = 40; // 40 × 3s = 2 minutes
      const poll = setInterval(async () => {
        attempts++;
        try {
          const { order: updated } = await api.getOrder(order.id);
          if (updated.status !== 'PAYMENT_PENDING') {
            clearInterval(poll);
            setConfirmingPayment(false);
            setOrder(updated);
            if (updated.status === 'PENDING') {
              toast.success('Payment confirmed! Your order is placed. 🚀');
            } else if (updated.status === 'CANCELLED') {
              toast.error('Order was cancelled.');
            } else {
              toast.info(`Order status: ${updated.status}`);
            }
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            setConfirmingPayment(false);
            toast.error('Payment confirmation timed out. Please refresh or contact support.');
          }
        } catch {
          // network error during poll — keep trying
        }
      }, 3000);

    } catch (err) {
      if (err.message !== 'Payment cancelled') {
        toast.error(err.message);
      }
    } finally {
      setProcessingPayment(false);
    }
  }


  return (
    <div className="app-layout">
      <Navbar />
      <CartDrawer />

      <main className="main-content">
        <div className="page-header">
          <Link to="/orders" className="back-link">← My Orders</Link>
        </div>

        {loading && <div className="page-center"><div className="spinner" /></div>}
        {error   && <div className="error-state"><p>⚠ {error}</p></div>}

        {!loading && !error && order && (
          <div className="order-detail">
            <div className="od-header">
              <div>
                <h1 className="od-id">Order #{order.id.slice(-8).toUpperCase()}</h1>
                <p className="od-date">
                  {new Date(order.createdAt).toLocaleString('en-IN', {
                    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              </div>
              <StatusBadge status={order.status} />
            </div>

            {/* Progress tracker */}
            {!isCancelled && (
              <div className="progress-track">
                {STEPS.map((step, idx) => (
                  <div key={step} className={`progress-step ${idx <= stepIdx ? 'done' : ''} ${idx === stepIdx ? 'current' : ''}`}>
                    <div className="step-dot" />
                    <span className="step-label">{STEP_LABELS[step]}</span>
                    {idx < STEPS.length - 1 && <div className="step-line" />}
                  </div>
                ))}
              </div>
            )}

            {isCancelled && (
              <div className="cancelled-banner">
                ❌ This order was cancelled
              </div>
            )}

            {order.status === 'PRESCRIPTION_PENDING' && (
              <div className="od-section" style={{ background: 'var(--blue-dim)', borderColor: 'var(--blue)' }}>
                <h2 className="od-section-title" style={{ color: 'var(--blue)' }}>Prescription Required</h2>
                
                {hasUploadedRx ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ color: 'var(--text)', fontSize: '14px', margin: 0 }}>
                      ✅ Your prescription has been uploaded.
                    </p>
                    <p style={{ color: 'var(--blue)', fontSize: '14px', margin: 0, fontWeight: 500 }}>
                      Prescription under pharmacist review...
                    </p>
                    <span className="spinner-sm" style={{ alignSelf: 'flex-start', marginTop: '8px', filter: 'brightness(2)' }} />
                  </div>
                ) : (
                  <>
                    <p style={{ color: 'var(--text)', fontSize: '14px', marginBottom: '16px' }}>
                      One or more medicines in your order require a valid prescription. Please upload it for verification by our pharmacists.
                    </p>
                    
                    {!rxFile ? (
                      <>
                        <input 
                          type="file" 
                          id="rx-upload" 
                          hidden 
                          onChange={handleRxUpload} 
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          disabled={uploadingRx}
                        />
                        <label htmlFor="rx-upload" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                          📄 Select Prescription File
                        </label>
                      </>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ background: 'var(--surface)', padding: '12px', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ color: 'var(--white)', fontSize: '14px' }}>{rxFile.name}</div>
                            <div style={{ color: 'var(--text2)', fontSize: '12px' }}>{(rxFile.size / 1024 / 1024).toFixed(2)} MB</div>
                          </div>
                          <button className="btn-outline-sm" onClick={() => setRxFile(null)} disabled={uploadingRx}>✕</button>
                        </div>
                        <button 
                          className="btn-primary" 
                          onClick={submitRxUpload}
                          disabled={uploadingRx}
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                        >
                          {uploadingRx ? <span className="spinner-sm" /> : 'Confirm & Upload'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {order.status === 'PAYMENT_PENDING' && (
              <div className="od-section" style={{ background: 'var(--blue-dim)', borderColor: 'var(--blue)' }}>
                <h2 className="od-section-title" style={{ color: 'var(--blue)' }}>Payment Required</h2>
                <p style={{ color: 'var(--text)', fontSize: '14px', marginBottom: '16px' }}>
                  Your prescription has been verified. Please complete your payment to confirm the order.
                </p>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button 
                    className="btn-primary" 
                    onClick={() => handlePayment('RAZORPAY')}
                    disabled={processingPayment || confirmingPayment}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                  >
                    {confirmingPayment
                      ? <><span className="spinner-sm" /> Confirming payment...</>
                      : processingPayment
                      ? <span className="spinner-sm" />
                      : `💳 Pay ₹${total.toFixed(2)} Online`}
                  </button>
                  <button 
                    className="btn-outline-sm" 
                    onClick={() => handlePayment('COD')}
                    disabled={processingPayment || confirmingPayment}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                  >
                    💵 Cash on Delivery
                  </button>
                </div>
              </div>
            )}

            {order.status === 'DELIVERED' && (
              <FeedbackCard 
                orderId={order.id} 
                existingRating={order.rating} 
                existingFeedback={order.feedback}
                onSubmitted={() => {
                  api.getOrder(order.id).then(({ order }) => setOrder(order));
                }} 
              />
            )}

            {order.status === 'OUT_FOR_DELIVERY' && (
              <div className="od-section" style={{ background: 'var(--green-dim)', borderColor: 'var(--green)' }}>
                <h2 className="od-section-title" style={{ color: 'var(--green)' }}>Delivery OTP</h2>
                <p style={{ color: 'var(--text)', fontSize: '14px', marginBottom: '16px' }}>
                  Provide this OTP to your rider to confirm the delivery.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {order._activeOtp ? (
                    <div style={{ padding: '12px', background: 'var(--surface)', borderRadius: 'var(--r-sm)', fontSize: '24px', letterSpacing: '4px', textAlign: 'center', fontWeight: 'bold' }}>
                      {order._activeOtp}
                    </div>
                  ) : (
                    <button 
                      className="btn-primary" 
                      onClick={async () => {
                        try {
                          const { otp } = await api.requestDeliveryOtp(order.id);
                          toast.success('OTP Generated');
                          setOrder(prev => ({ ...prev, _activeOtp: otp }));
                        } catch (e) {
                          toast.error(e.message);
                        }
                      }}
                    >
                      Get Delivery OTP
                    </button>
                  )}
                </div>
              </div>
            )}

{!isCancelled && ['ACCEPTED', 'OUT_FOR_DELIVERY'].includes(order.status) && (

              <TrackingScreen 
                key={order.id} 
                orderId={order.id} 
                customerLocation={
                  // Safely check for both camelCase and snake_case!
                  (order.deliveryLat || order.delivery_lat) && (order.deliveryLng || order.delivery_lng)
                    ? { 
                        lat: Number(order.deliveryLat || order.delivery_lat), 
                        lng: Number(order.deliveryLng || order.delivery_lng) 
                      }
                    : { lat: 25.4358, lng: 81.8463 } // Prayagraj Fallback
                }
              />
            )}

            {order.rider && !isCancelled && (
              <div className="od-section" style={{ marginTop: '24px' }}>
                <h2 className="od-section-title">Delivery Partner</h2>
                <div style={{ background: 'var(--surface)', padding: '16px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--cyan-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>
                    🛵
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ color: 'var(--white)', margin: '0 0 4px', fontSize: '16px' }}>{order.rider.full_name}</h3>
                    <p style={{ color: 'var(--text)', margin: 0, fontSize: '14px' }}>{order.rider.phone_number}</p>
                  </div>
                  <a href={`tel:${order.rider.phone_number}`} className="btn-outline-sm" style={{ padding: '8px 12px' }}>
                    📞 Call
                  </a>
                </div>
              </div>
            )}

            {/* Items */}
            <div className="od-section">
              <h2 className="od-section-title">Items Ordered</h2>
              <ul className="od-items">
                {order.orderItems?.map(item => (
                  <li key={item.id} className="od-item">
                    <span className="oi-icon">💊</span>
                    <div className="oi-info">
                      <span className="oi-name">{item.medicine?.name ?? 'Medicine'}</span>
                      <span className="oi-qty">Qty: {item.quantity}</span>
                    </div>
                    <span className="oi-price">₹{(parseFloat(item.unit_price) * item.quantity).toFixed(2)}</span>
                  </li>
                ))}
              </ul>

              <div className="od-total">
                <span>Total Paid</span>
                <strong>₹{total.toFixed(2)}</strong>
              </div>
            </div>

            {order.pharmacy && (
              <div className="od-section">
                <h2 className="od-section-title">Fulfilling Pharmacy</h2>
                <div className="pharmacy-pill">
                  <span>🏥</span>
                  <span>{order.pharmacy.name}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
