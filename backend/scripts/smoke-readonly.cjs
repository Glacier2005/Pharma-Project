// Uses documented demo accounts; never creates orders or changes database rows.
const base = process.env.SMOKE_BASE_URL || 'http://localhost:8080';
let failures = 0;
async function check(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  console.log(`PASS ${options.method || 'GET'} ${path}`);
  return data;
}
async function run() {
  for (const path of ['/health', '/api/medicines', '/api/pharmacies']) {
    try { await check(path); } catch (error) { failures++; console.error(error.message); }
  }
  const accounts = [
    ['CUSTOMER', '+15550100001', 'customer123', ['/api/users/me', '/api/orders']],
    ['RIDER', '+15550100002', 'rider123', ['/api/users/me', '/api/orders']],
    ['ADMIN', '+15550100003', 'admin123', ['/api/admin/analytics', '/api/users', '/api/inventory', '/api/orders']],
    ['PHARMACIST', '+15550100004', 'pharmacist123', ['/api/prescriptions/pending', '/api/inventory']],
  ];
  for (const [role, phone_number, password, paths] of accounts) {
    try {
      const { token, user } = await check('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone_number, password }) });
      if (!token || user.role !== role) throw new Error(`Unexpected login result for ${role}`);
      console.log(`PASS ${role} login`);
      for (const path of paths) {
        const data = await check(path, { headers: { Authorization: `Bearer ${token}` } });
        if (role === 'CUSTOMER' && path === '/api/orders' && data.data.length) {
          await check(`/api/orders/${data.data[0].id}`, { headers: { Authorization: `Bearer ${token}` } });
        }
      }
    } catch (error) { failures++; console.error(`FAIL ${role}: ${error.message}`); }
  }
  console.log(`Read-only smoke completed: ${failures} failure(s)`);
  process.exitCode = failures ? 1 : 0;
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
