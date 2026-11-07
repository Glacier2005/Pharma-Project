export const API_BASE = import.meta.env.VITE_API_URL || '';
const BASE = API_BASE;

const getToken = () => localStorage.getItem('pd_token');

async function req(path, opts = {}) {
  const token = getToken();
  let res;
  try {
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    };
    
    // Auto-set Content-Type for JSON if body is a string (JSON)
    if (typeof opts.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers,
    });
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error. Please check your internet connection.', { cause: error });
    }
    throw error;
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }
  
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new Event('unauthorized'));
    }
    const errMsg = data.error && typeof data.error === 'object' ? data.error.message : data.error;
    throw new Error(errMsg ?? `HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  login:        (body) => req('/api/auth/login',    { method: 'POST', body: JSON.stringify(body) }),
  register:     (body) => req('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  getMe:        ()     => req('/api/users/me'),
  getMedicines: ()     => req('/api/medicines'),
  getPharmacies:()     => req('/api/pharmacies'),
  createOrder:  (body) => req('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  getOrders:    (params = {}) => req(`/api/orders?${new URLSearchParams(params)}`),
  getOrder:     (id)   => req(`/api/orders/${id}`),
  processPayment: (id, payload) => req(`/api/orders/${id}/payment`, { method: 'POST', body: JSON.stringify(payload) }),
  updateOrderStatus: (id, status) => req(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  // Inventory (admin)
  getInventory:  (params = {}) => req(`/api/inventory?${new URLSearchParams(params)}`),
  getInventoryItem: (id) => req(`/api/inventory/${id}`),
  addBatch:      (id, payload) => req(`/api/inventory/${id}/batches`, { method: 'POST', body: JSON.stringify(payload) }),
  adjustBatchStock: (batchId, payload) => req(`/api/inventory/batches/${batchId}/adjust`, { method: 'POST', body: JSON.stringify(payload) }),
  // Users (admin)
  getUsers:     (params = {}) => req(`/api/users?${new URLSearchParams(params)}`),
  getAdminStats:() => req('/api/admin/analytics'),
  submitFeedback: (id, payload) => req(`/api/orders/${id}/feedback`, { method: 'PATCH', body: JSON.stringify(payload) }),
  requestDeliveryOtp: (id) => req(`/api/orders/${id}/delivery/request-otp`, { method: 'POST' }),
  verifyDeliveryOtp: (id, otp) => req(`/api/orders/${id}/delivery/verify-otp`, { method: 'POST', body: JSON.stringify({ otp }) }),

  scanPrescription: (formData) => req('/api/medicines/scan', { method: 'POST', body: formData }),

  // Prescriptions
  uploadPrescription: (orderId, formData) => req(`/api/orders/${orderId}/prescriptions`, { method: 'POST', body: formData }),
  getPendingPrescriptions: () => req('/api/prescriptions/pending'),
  claimPrescription: (id) => req(`/api/prescriptions/${id}/claim`, { method: 'PATCH' }),
  verifyPrescription: (id, payload) => req(`/api/prescriptions/${id}/verify`, { method: 'PATCH', body: JSON.stringify(payload) }),
  
  getPrescriptionImageBlob: async (id) => {
    const token = getToken();
    const res = await fetch(`${BASE}/api/prescriptions/${id}/image`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const { url } = await res.json();
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status} from signed URL`);
      return await imgRes.blob();
    }
    
    return await res.blob();
  }
};
