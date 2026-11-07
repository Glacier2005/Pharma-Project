import request from 'supertest';
import crypto from 'node:crypto';
import path from 'node:path';
import { io as connectSocket, Socket } from 'socket.io-client';
import { prisma } from '../src/db/prisma';
import { app, httpServer, io } from '../src/index';
import { signToken } from '../src/lib/jwt';
import { initiateRefundIfPaid } from '../src/controllers/payment.controller';
import { getRazorpayClient } from '../src/services/RazorpayService';

jest.mock('../src/services/RazorpayService', () => ({
  ...jest.requireActual('../src/services/RazorpayService'),
  getRazorpayClient: jest.fn(),
}));

const fixture = path.join(__dirname, 'fixtures/ocr.png');
const sockets: Socket[] = [];
let pharmacyId: string, medicineId: string, inventoryId: string, batchId: string;
let customer: string, rider: string, otherRider: string, pharmacist: string;
let base: string;
const auth = (id: string, role = 'CUSTOMER') => `Bearer ${signToken({ sub: id, role, pharmacyId })}`;
async function createOrder(emergency = false) {
  const result = await request(app).post('/api/orders').set('Authorization', auth(customer)).send({
    items: [{ medicineId, quantity: 1 }], is_emergency: emergency,
    delivery_address: 'Test address', delivery_lat: 0, delivery_lng: 0,
  });
  expect(result.status).toBe(201);
  return result.body.order;
}
async function pay(id: string) {
  const result = await request(app).post(`/api/orders/${id}/payment`).set('Authorization', auth(customer)).send({ method: 'COD' });
  expect(result.status).toBe(200);
}
const advance = (id: string, status: string, actor = rider) => request(app)
  .patch(`/api/orders/${id}/status`).set('Authorization', auth(actor, 'RIDER')).send({ status });
async function socketFor(id: string, role: string) {
  const socket = connectSocket(base, { transports: ['websocket'], auth: { token: signToken({ sub: id, role, pharmacyId }) }, autoConnect: false });
  sockets.push(socket);
  const ready = new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
  socket.connect();
  await ready;
  return socket;
}
async function waitForRoom(socket: Socket, room: string) {
  for (let i = 0; i < 100; i++) {
    if (io.sockets.sockets.get(socket.id!)?.rooms.has(room)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Socket did not join tracking room');
}

beforeAll(async () => {
  process.env.PAYMENT_PROVIDER = 'local';
  const pharmacy = await prisma.pharmacy.create({ data: { name: 'Remaining integration', latitude: 0, longitude: 0 } });
  pharmacyId = pharmacy.id;
  const ids = [];
  for (const role of ['CUSTOMER', 'RIDER', 'RIDER', 'PHARMACIST'] as const) {
    const user = await prisma.user.create({ data: { role, full_name: `Test ${role}`, phone_number: crypto.randomUUID(), password_hash: 'test', pharmacyId } });
    ids.push(user.id);
  }
  [customer, rider, otherRider, pharmacist] = ids;
  const medicine = await prisma.medicine.create({ data: { name: 'TEST MEDICINE 10 MG', generic_name: 'Test medicine', price: 10, manufacturer: 'Test' } });
  medicineId = medicine.id;
  const inventory = await prisma.inventory.create({ data: { pharmacyId, medicineId } });
  inventoryId = inventory.id;
  const batch = await prisma.batch.create({ data: { inventoryId, batchNumber: 'REMAINING', quantity: 100, expiryDate: new Date('2099-01-01') } });
  batchId = batch.id;
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(httpServer.address() as { port: number }).port}`;
});

afterAll(async () => {
  process.env.PAYMENT_PROVIDER = 'local';
  sockets.forEach(socket => socket.disconnect());
  await new Promise<void>(resolve => io.close(() => resolve()));
  await prisma.prescription.deleteMany({ where: { customerId: customer } });
  await prisma.inventoryTransaction.deleteMany({ where: { batchId } });
  await prisma.order.deleteMany({ where: { customerId: customer } });
  await prisma.batch.deleteMany({ where: { inventoryId } });
  await prisma.inventory.deleteMany({ where: { id: inventoryId } });
  await prisma.medicine.deleteMany({ where: { id: medicineId } });
  await prisma.user.deleteMany({ where: { id: { in: [customer, rider, otherRider, pharmacist] } } });
  await prisma.pharmacy.deleteMany({ where: { id: pharmacyId } });
  await prisma.$disconnect();
});

test('real OCR finds the catalogue medicine and its authoritative price', async () => {
  const response = await request(app).post('/api/medicines/scan').set('Authorization', auth(customer)).attach('prescription', fixture);
  expect(response.status).toBe(200);
  expect(response.body.medicines).toEqual(expect.arrayContaining([expect.objectContaining({ id: medicineId, price: '10' })]));
});

test('complete prescription upload, local image retrieval, review, COD, pickup, OTP and feedback', async () => {
  await prisma.medicine.update({ where: { id: medicineId }, data: { requires_prescription: true } });
  const order = await createOrder();
  expect(order.status).toBe('PRESCRIPTION_PENDING');
  const uploaded = await request(app).post(`/api/orders/${order.id}/prescriptions`).set('Authorization', auth(customer)).attach('prescription', fixture);
  expect(uploaded.status).toBe(201);
  expect(uploaded.body.prescription.ocrText).toMatch(/TEST MEDICINE/i);
  const rxId = uploaded.body.prescription.id;
  const image = await request(app).get(`/api/prescriptions/${rxId}/image`).set('Authorization', auth(customer));
  expect(image.status).toBe(200);
  expect(image.headers['content-type']).toMatch(/image\/png/);
  expect((await request(app).get(`/api/prescriptions/${rxId}/image`).set('Authorization', auth(rider, 'RIDER'))).status).toBe(403);
  expect((await request(app).patch(`/api/prescriptions/${rxId}/claim`).set('Authorization', auth(pharmacist, 'PHARMACIST'))).status).toBe(200);
  expect((await request(app).patch(`/api/prescriptions/${rxId}/verify`).set('Authorization', auth(pharmacist, 'PHARMACIST')).send({ status: 'APPROVED' })).status).toBe(200);
  await pay(order.id);
  expect((await advance(order.id, 'ACCEPTED')).status).toBe(200);
  expect((await advance(order.id, 'OUT_FOR_DELIVERY')).status).toBe(200);
  const issued = await request(app).post(`/api/orders/${order.id}/delivery/request-otp`).set('Authorization', auth(customer));
  expect(issued.status).toBe(200);
  const verified = await request(app).post(`/api/orders/${order.id}/delivery/verify-otp`).set('Authorization', auth(rider, 'RIDER')).send({ otp: issued.body.otp });
  expect(verified.status).toBe(200);
  expect(verified.body.order.status).toBe('DELIVERED');
  expect((await request(app).patch(`/api/orders/${order.id}/feedback`).set('Authorization', auth(customer)).send({ rating: 5, feedback: 'Integration passed' })).status).toBe(200);
  await prisma.medicine.update({ where: { id: medicineId }, data: { requires_prescription: false } });
});

test('SOS fee is persisted, prioritised and cannot be batched under concurrent claims', async () => {
  const regular = await createOrder();
  const sos = await createOrder(true);
  expect(sos.is_emergency).toBe(true);
  expect(sos.total_amount).toBe('138');
  await pay(regular.id); await pay(sos.id);
  const listed = await request(app).get('/api/orders').set('Authorization', auth(rider, 'RIDER'));
  expect(listed.body.data.findIndex((o: any) => o.id === sos.id)).toBeLessThan(listed.body.data.findIndex((o: any) => o.id === regular.id));
  const claims = await Promise.all([advance(sos.id, 'ACCEPTED'), advance(regular.id, 'ACCEPTED')]);
  expect(claims.map(r => r.status).sort()).toEqual([200, 409]);
  const active = await prisma.order.findMany({ where: { riderId: rider, status: 'ACCEPTED' } });
  expect(active).toHaveLength(1);
  for (const id of [sos.id, regular.id]) await request(app).patch(`/api/orders/${id}/status`).set('Authorization', auth(customer)).send({ status: 'CANCELLED' });
});

test('concurrent customer cancellations restore stock once', async () => {
  const before = (await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).quantity;
  const order = await createOrder();
  const responses = await Promise.all([1, 2].map(() => request(app).patch(`/api/orders/${order.id}/status`).set('Authorization', auth(customer)).send({ status: 'CANCELLED' })));
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect((await prisma.batch.findUniqueOrThrow({ where: { id: batchId } })).quantity).toBe(before);
  expect(await prisma.inventoryTransaction.count({ where: { referenceId: order.id, transactionType: 'CANCELLATION' } })).toBe(1);
});

test('real Socket.IO tracking is private and works after reconnect', async () => {
  const order = await createOrder(); await pay(order.id); await advance(order.id, 'ACCEPTED');
  const customerSocket = await socketFor(customer, 'CUSTOMER');
  const riderSocket = await socketFor(rider, 'RIDER');
  const outsider = await socketFor(otherRider, 'RIDER');
  customerSocket.emit('join_tracking_room', order.id); await waitForRoom(customerSocket, order.id);
  outsider.emit('join_tracking_room', order.id);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(io.sockets.sockets.get(outsider.id!)?.rooms.has(order.id)).toBe(false);
  const received = new Promise(resolve => customerSocket.once('location_update', resolve));
  riderSocket.emit('rider_location_update', { orderId: order.id, lat: 0, lng: 0 });
  expect(await received).toEqual({ lat: 0, lng: 0 });
  customerSocket.disconnect();
  const reconnect = new Promise<void>(resolve => customerSocket.once('connect', () => resolve()));
  customerSocket.connect(); await reconnect;
  customerSocket.emit('join_tracking_room', order.id); await waitForRoom(customerSocket, order.id);
  const afterReconnect = new Promise(resolve => customerSocket.once('location_update', resolve));
  riderSocket.emit('rider_location_update', { orderId: order.id, lat: 12.3, lng: 77.5 });
  expect(await afterReconnect).toEqual({ lat: 12.3, lng: 77.5 });
  sockets.forEach(socket => socket.disconnect());
  await request(app).patch(`/api/orders/${order.id}/status`).set('Authorization', auth(customer)).send({ status: 'CANCELLED' });
});

test('Razorpay checkout uses database amount and concurrent refund dispatch happens once', async () => {
  const order = await createOrder();
  process.env.PAYMENT_PROVIDER = 'razorpay';
  const refund = jest.fn().mockResolvedValue({ id: `refund_${order.id}` });
  const create = jest.fn().mockResolvedValue({ id: `rz_${order.id}`, amount: 3900, currency: 'INR' });
  (getRazorpayClient as jest.Mock).mockReturnValue({ orders: { create }, payments: { refund } });
  const checkout = await request(app).post(`/api/orders/${order.id}/payment`).set('Authorization', auth(customer)).send({ method: 'RAZORPAY', amount: 1 });
  expect(checkout.status).toBe(200);
  expect(checkout.body.amount).toBe(3900);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 3900 }));
  process.env.RAZORPAY_WEBHOOK_SECRET = 'integration-webhook-secret';
  const payload = JSON.stringify({ event: 'order.paid', payload: { payment: { entity: { id: `paid_${order.id}`, order_id: `rz_${order.id}`, amount: 3900, currency: 'INR', status: 'captured' } } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest('hex');
  expect((await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(payload)).status).toBe(200);
  const cancelled = await Promise.all([1, 2].map(() => request(app).patch(`/api/orders/${order.id}/status`).set('Authorization', auth(customer)).send({ status: 'CANCELLED' })));
  expect(cancelled.map(r => r.status)).toEqual([200, 200]);
  await Promise.all([initiateRefundIfPaid(order.id, customer), initiateRefundIfPaid(order.id, customer)]);
  expect((await request(app).post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(payload)).status).toBe(200);
  expect(refund).toHaveBeenCalledTimes(1);
  expect((await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe('REFUNDED');
  process.env.PAYMENT_PROVIDER = 'local';
});
