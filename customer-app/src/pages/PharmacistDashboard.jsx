import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Navbar } from '../components/Navbar';
import { useToast } from '../context/toast-context';
import { useAuth } from '../context/auth-context';

export function PharmacistDashboard() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRx, setSelectedRx] = useState(null);
  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState('PENDING'); // PENDING or CLAIMS

  // Modal states
  const [showRejectModal, setShowRejectModal] = useState(false);

  // Image state
  const [imageBlobUrl, setImageBlobUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  const toast = useToast();
  const { user } = useAuth();

  useEffect(() => {
    fetchPending();
  }, []);

  // Fetch image securely when selectedRx changes
  useEffect(() => {
    if (selectedRx) {
      let isMounted = true;
      let objectUrl;


      api.getPrescriptionImageBlob(selectedRx.id)
        .then(blob => {
          if (isMounted) {
            objectUrl = URL.createObjectURL(blob);
            setImageBlobUrl(objectUrl);
            setImageLoading(false);
          }
        })
        .catch(e => {
          if (isMounted) {
            console.error('Failed to load image:', e);
            setImageError(true);
            setImageLoading(false);
          }
        });

      return () => {
        isMounted = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
  }, [selectedRx]);

  function selectPrescription(rx) {
    setImageLoading(true);
    setImageError(false);
    setImageBlobUrl(null);
    setSelectedRx(rx);
  }

  async function fetchPending() {
    setLoading(true);
    try {
      const { prescriptions } = await api.getPendingPrescriptions();
      setPrescriptions(prescriptions);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim(rx) {
    try {
      await api.claimPrescription(rx.id);
      toast.success('Prescription claimed!');
      selectPrescription({ ...rx, pharmacistId: user?.id || 'me' });
      fetchPending();
      setActiveTab('CLAIMS'); // Switch to claims view automatically
    } catch (e) {
      if (e.message.includes('409') || e.message.toLowerCase().includes('already claimed')) {
        toast.error('This prescription has already been claimed by another pharmacist.');
        fetchPending(); // refresh to see the change
      } else {
        toast.error(e.message);
      }
    }
  }

  async function handleVerify(status) {
    if (status === 'REJECTED' && !notes.trim()) {
      toast.error('Rejection reason is required');
      return;
    }
    setProcessing(true);
    try {
      await api.verifyPrescription(selectedRx.id, { status, notes });
      toast.success(`Prescription ${status.toLowerCase()}!`);
      setSelectedRx(null);
      setNotes('');
      setShowRejectModal(false);
      fetchPending();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setProcessing(false);
    }
  }

  const myClaims = prescriptions.filter(rx => rx.pharmacistId === user?.id);
  const pendingReview = prescriptions.filter(rx => !rx.pharmacistId);
  const currentList = activeTab === 'PENDING' ? pendingReview : myClaims;

  return (
    <div className="app-layout">
      <Navbar />
      <main className="main-content" style={{ padding: '24px' }}>
        <h1 style={{ color: 'var(--white)', marginBottom: '24px' }}>Pharmacist Dashboard</h1>

        {loading ? (
          <div className="spinner" />
        ) : error ? (
          <div className="error-state"><p>⚠ {error}</p></div>
        ) : (
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            {/* List */}
            <div style={{ flex: '1 1 300px', background: 'var(--surface)', borderRadius: 'var(--r-md)', padding: '16px' }}>

              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <button
                  style={{ background: 'transparent', color: activeTab === 'PENDING' ? 'var(--cyan)' : 'var(--text2)', border: 'none', borderBottom: `2px solid ${activeTab === 'PENDING' ? 'var(--cyan)' : 'transparent'}`, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setActiveTab('PENDING')}
                >
                  Pending Review ({pendingReview.length})
                </button>
                <button
                  style={{ background: 'transparent', color: activeTab === 'CLAIMS' ? 'var(--cyan)' : 'var(--text2)', border: 'none', borderBottom: `2px solid ${activeTab === 'CLAIMS' ? 'var(--cyan)' : 'transparent'}`, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setActiveTab('CLAIMS')}
                >
                  My Claims ({myClaims.length})
                </button>
              </div>

              {currentList.length === 0 && (
                <p style={{ color: 'var(--text2)' }}>
                  {activeTab === 'PENDING' ? 'No prescriptions are waiting for review.' : 'You have no claimed prescriptions.'}
                </p>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {currentList.map(rx => (
                  <div
                    key={rx.id}
                    onClick={() => selectPrescription(rx)}
                    style={{
                      padding: '12px',
                      background: selectedRx?.id === rx.id ? 'var(--cyan-dim)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${selectedRx?.id === rx.id ? 'var(--cyan)' : 'transparent'}`,
                      borderRadius: 'var(--r-sm)',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ color: 'var(--white)', fontWeight: '500' }}>Order #{rx.orderId.slice(-8).toUpperCase()}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text)' }}>
                      Submitted: {new Date(rx.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail View */}
            {selectedRx && (
              <div style={{ flex: '2 1 500px', background: 'var(--surface)', borderRadius: 'var(--r-md)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ color: 'var(--white)', fontSize: '20px', margin: 0 }}>Verify Prescription</h2>
                  <button className="btn-outline-sm" onClick={() => setSelectedRx(null)}>✕ Close</button>
                </div>

                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  {/* Image Viewer */}
                  <div style={{ flex: '1 1 300px' }}>
                    <div style={{ width: '100%', minHeight: '400px', background: '#000', borderRadius: 'var(--r-sm)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {imageLoading && <div className="spinner" />}
                      {imageError && <div style={{ color: 'var(--red)', padding: '20px', textAlign: 'center' }}>Failed to load image securely.</div>}
                      {imageBlobUrl && !imageLoading && !imageError && (
                        <img
                          src={imageBlobUrl}
                          alt="Prescription"
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Details & Action */}
                  <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: 'var(--r-sm)' }}>
                      <h3 style={{ color: 'var(--cyan)', fontSize: '14px', margin: '0 0 8px 0' }}>AI Suggestions — NOT VERIFIED</h3>
                      {selectedRx.aiSuggestions && selectedRx.aiSuggestions.medicines ? (
                        <>
                          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text)', fontSize: '14px', marginBottom: '8px' }}>
                            {selectedRx.aiSuggestions.medicines.map((m, i) => (
                              <li key={i}>{m.name} {m.strength && `(${m.strength})`} - {m.dosage}</li>
                            ))}
                          </ul>
                          <div style={{ color: 'var(--text2)', fontSize: '12px', fontStyle: 'italic', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: 'var(--r-sm)' }}>
                            These suggestions are for assistance only. A pharmacist must verify the prescription.
                          </div>
                        </>
                      ) : (
                        <p style={{ margin: 0, color: 'var(--text2)', fontSize: '14px' }}>AI extraction unavailable. Please verify manually.</p>
                      )}
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: 'var(--r-sm)' }}>
                      <h3 style={{ color: 'var(--white)', fontSize: '14px', margin: '0 0 8px 0' }}>Ordered Items</h3>
                      <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text)', fontSize: '14px' }}>
                        {selectedRx.order.orderItems.map(item => (
                          <li key={item.id}>{item.quantity}x {item.medicine.name} {item.medicine.strength && `(${item.medicine.strength})`}</li>
                        ))}
                      </ul>
                    </div>

                    {!selectedRx.pharmacistId ? (
                      <button className="btn-primary" onClick={() => handleClaim(selectedRx)}>
                        Claim to Review
                      </button>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <button
                            style={{ flex: 1, background: 'var(--surface)', color: 'var(--red)', border: '1px solid var(--red)', padding: '12px', borderRadius: 'var(--r-sm)', fontWeight: 600, cursor: processing ? 'not-allowed' : 'pointer', opacity: processing ? 0.7 : 1 }}
                            onClick={() => setShowRejectModal(true)}
                            disabled={processing}
                          >
                            Reject
                          </button>
                          <button
                            className="btn-primary"
                            style={{ flex: 1 }}
                            onClick={() => handleVerify('APPROVED')}
                            disabled={processing}
                          >
                            {processing ? <span className="spinner-sm" /> : 'Approve'}
                          </button>
                        </div>
                      </>
                    )}

                  </div>
                </div>

              </div>
            )}
          </div>
        )}
      </main>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="modal-overlay" onClick={() => !processing && setShowRejectModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header" style={{ flexDirection: 'column', paddingBottom: 0 }}>
              <h3 style={{ color: 'var(--red)' }}>Reject Prescription?</h3>
              <p style={{ color: 'var(--text2)', fontSize: '14px' }}>
                The order will be cancelled and reserved inventory will be released.
              </p>
            </div>
            <div className="modal-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
              <textarea
                placeholder="Reason for rejection (Required)"
                className="input-field"
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                autoFocus
              />
            </div>

            <div className="modal-cta" style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button className="btn-outline" style={{ flex: 1 }} onClick={() => setShowRejectModal(false)} disabled={processing}>Cancel</button>
              <button
                style={{ flex: 1, background: 'var(--red)', color: 'white', padding: '12px', border: 'none', borderRadius: 'var(--r-sm)', fontWeight: 600, cursor: processing || !notes.trim() ? 'not-allowed' : 'pointer', opacity: processing || !notes.trim() ? 0.7 : 1 }}
                onClick={() => handleVerify('REJECTED')}
                disabled={processing || !notes.trim()}
              >
                {processing ? <span className="spinner-sm" /> : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
