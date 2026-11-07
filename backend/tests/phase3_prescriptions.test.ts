import request from 'supertest';
import { app } from '../src/index';
import { prisma } from '../src/db/prisma';
import { signToken } from '../src/lib/jwt';
import path from 'path';

describe('Phase 3 - Prescription Workflow (BOLA & Lifecycle)', () => {
  let customerToken: string;
  let customerId: string;
  let pharmacistToken: string;
  let pharmacistId: string;
  let otherPharmacistToken: string;
  let otherPharmacyId: string;
  let pharmacyId: string;
  let orderId: string;
  let prescriptionId: string;

  beforeAll(async () => {
    // Setup users and pharmacy
    const pharmacy = await prisma.pharmacy.create({
      data: { name: 'Rx Pharmacy 1', latitude: 0, longitude: 0 }
    });
    pharmacyId = pharmacy.id;

    const pharmacy2 = await prisma.pharmacy.create({
      data: { name: 'Rx Pharmacy 2', latitude: 0, longitude: 0 }
    });
    otherPharmacyId = pharmacy2.id;

    const customer = await prisma.user.create({
      data: { role: 'CUSTOMER', phone_number: '1234567890', full_name: 'Test Customer', password_hash: 'hash' }
    });
    customerId = customer.id;
    customerToken = signToken({ sub: customer.id, role: customer.role, pharmacyId: customer.pharmacyId || undefined });

    const pharmacist = await prisma.user.create({
      data: { role: 'PHARMACIST', phone_number: '0987654321', full_name: 'Test Pharmacist', password_hash: 'hash', pharmacyId }
    });
    pharmacistId = pharmacist.id;
    pharmacistToken = signToken({ sub: pharmacist.id, role: pharmacist.role, pharmacyId: pharmacist.pharmacyId || undefined });

    const otherPharmacist = await prisma.user.create({
      data: { role: 'PHARMACIST', phone_number: '1111111111', full_name: 'Other Pharmacist', password_hash: 'hash', pharmacyId: otherPharmacyId }
    });
    otherPharmacistToken = signToken({ sub: otherPharmacist.id, role: otherPharmacist.role, pharmacyId: otherPharmacist.pharmacyId || undefined });

    const order = await prisma.order.create({
      data: {
        customerId,
        pharmacyId,
        status: 'PRESCRIPTION_PENDING',
        total_amount: 100.00
      }
    });
    orderId = order.id;
  });

  afterAll(async () => {
    await prisma.prescription.deleteMany({});
    await prisma.orderItemBatchAllocation.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.inventoryTransaction.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.batch.deleteMany({});
    await prisma.inventory.deleteMany({});
    await prisma.medicine.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.pharmacy.deleteMany({});
  });

  describe('1. Prescription Upload', () => {
    it('should block unauthenticated upload', async () => {
      const res = await request(app).post(`/api/orders/${orderId}/prescriptions`).send();
      expect(res.status).toBe(401);
    });

    it('should block upload if order does not belong to customer (BOLA)', async () => {
      const otherCustomer = await prisma.user.create({
        data: { role: 'CUSTOMER', phone_number: '2222222222', full_name: 'Other Customer', password_hash: 'hash' }
      });
      const otherCustomerToken = signToken({ sub: otherCustomer.id, role: otherCustomer.role, pharmacyId: otherCustomer.pharmacyId || undefined });

      const res = await request(app)
        .post(`/api/orders/${orderId}/prescriptions`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .attach('prescription', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'), 'rx.png');
      
      expect(res.status).toBe(403);
    });

    it('should allow valid upload and return prescription', async () => {
      // Use a mock text file as image for testing upload
      const res = await request(app)
        .post(`/api/orders/${orderId}/prescriptions`)
        .set('Authorization', `Bearer ${customerToken}`)
        .attach('prescription', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'), 'rx.png');

      expect(res.status).toBe(201);
      expect(res.body.prescription).toBeDefined();
      expect(res.body.prescription.status).toBe('PENDING');
      expect(res.body.prescription.storageKey).toBeDefined();
      prescriptionId = res.body.prescription.id;
    });
  });

  describe('2. Pharmacist Pending List', () => {
    it('should return pending prescriptions for the assigned pharmacy', async () => {
      const res = await request(app)
        .get('/api/prescriptions/pending')
        .set('Authorization', `Bearer ${pharmacistToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.prescriptions.length).toBeGreaterThan(0);
      expect(res.body.prescriptions[0].id).toBe(prescriptionId);
    });

    it('should NOT return pending prescriptions for a different pharmacy', async () => {
      const res = await request(app)
        .get('/api/prescriptions/pending')
        .set('Authorization', `Bearer ${otherPharmacistToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.prescriptions.length).toBe(0);
    });
  });

  describe('3. Pharmacist Claim', () => {
    it('should block claiming a prescription from a different pharmacy', async () => {
      const res = await request(app)
        .patch(`/api/prescriptions/${prescriptionId}/claim`)
        .set('Authorization', `Bearer ${otherPharmacistToken}`);
      
      expect(res.status).toBe(403);
    });

    it('should allow claiming a prescription by assigned pharmacist', async () => {
      const res = await request(app)
        .patch(`/api/prescriptions/${prescriptionId}/claim`)
        .set('Authorization', `Bearer ${pharmacistToken}`);
      
      expect(res.status).toBe(200);

      const rx = await prisma.prescription.findUnique({ where: { id: prescriptionId } });
      expect(rx?.pharmacistId).toBe(pharmacistId);
    });

    it('should prevent another pharmacist from claiming an already claimed prescription', async () => {
      // Create another pharmacist in the same pharmacy
      const secondPharmacist = await prisma.user.create({
        data: { role: 'PHARMACIST', phone_number: '3333333333', full_name: 'Second Pharmacist', password_hash: 'hash', pharmacyId }
      });
      const secondPharmacistToken = signToken({ sub: secondPharmacist.id, role: secondPharmacist.role, pharmacyId: secondPharmacist.pharmacyId || undefined });

      const res = await request(app)
        .patch(`/api/prescriptions/${prescriptionId}/claim`)
        .set('Authorization', `Bearer ${secondPharmacistToken}`);
      
      expect(res.status).toBe(409); // Conflict
    });
  });

  describe('4. Prescription Verification', () => {
    it('should block verification by unassigned pharmacist (even in same pharmacy)', async () => {
      const secondPharmacist = await prisma.user.findUnique({ where: { phone_number: '3333333333' } });
      const secondPharmacistToken = signToken({ sub: secondPharmacist!.id, role: secondPharmacist!.role, pharmacyId: secondPharmacist!.pharmacyId || undefined });

      const res = await request(app)
        .patch(`/api/prescriptions/${prescriptionId}/verify`)
        .set('Authorization', `Bearer ${secondPharmacistToken}`)
        .send({ status: 'APPROVED' });
      
      expect(res.status).toBe(403);
    });

    it('should reject verification with invalid status', async () => {
      const res = await request(app)
        .patch(`/api/prescriptions/${prescriptionId}/verify`)
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .send({ status: 'WEIRD_STATUS' });
      
      expect(res.status).toBe(400);
    });

    it('should allow the assigned pharmacist to approve the prescription', async () => {
      const res = await request(app)
        .patch(`/api/prescriptions/${prescriptionId}/verify`)
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .send({ status: 'APPROVED' });
      
      expect(res.status).toBe(200);
      expect(res.body.prescription.status).toBe('APPROVED');

      // Check that the order transitioned to PAYMENT_PENDING
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      expect(order?.status).toBe('PAYMENT_PENDING');
    });

    it('should not allow verifying an already verified prescription', async () => {
      const res = await request(app)
        .patch(`/api/prescriptions/${prescriptionId}/verify`)
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .send({ status: 'REJECTED', notes: 'Changed my mind' });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already verified/i);
    });
  });

  describe('5. Prescription Rejection (Lifecycle Test)', () => {
    let rejectionOrderId: string;
    let rejectionRxId: string;
    let batchId: string;

    beforeAll(async () => {
      // Create a medicine and batch to test inventory restoration
      const medicine = await prisma.medicine.create({
        data: { name: 'Meds', generic_name: 'Meds', price: 10, manufacturer: 'Manu', requires_prescription: true }
      });
      const inventory = await prisma.inventory.create({
        data: { pharmacyId, medicineId: medicine.id }
      });
      const batch = await prisma.batch.create({
        data: { inventoryId: inventory.id, batchNumber: 'B1', expiryDate: new Date('2050-01-01'), quantity: 90 } // 10 already deducted
      });
      batchId = batch.id;

      // Create an order with items and allocation
      const order = await prisma.order.create({
        data: { customerId, pharmacyId, status: 'PRESCRIPTION_PENDING', total_amount: 10 }
      });
      rejectionOrderId = order.id;

      const orderItem = await prisma.orderItem.create({
        data: { orderId: order.id, medicineId: medicine.id, quantity: 10, unit_price: 10 }
      });
      
      await prisma.orderItemBatchAllocation.create({
        data: { orderItemId: orderItem.id, batchId: batch.id, quantity: 10 }
      });

      // Create a prescription for this order
      const rx = await prisma.prescription.create({
        data: { orderId: order.id, customerId, storageKey: 'test.png', originalFilename: 'test.png', mimeType: 'image/png', fileSize: 100, pharmacistId }
      });
      rejectionRxId = rx.id;
    });

    it('should restore inventory and cancel order when rejected', async () => {
      const res = await request(app)
        .patch(`/api/prescriptions/${rejectionRxId}/verify`)
        .set('Authorization', `Bearer ${pharmacistToken}`)
        .send({ status: 'REJECTED', notes: 'Illegible prescription' });
      
      expect(res.status).toBe(200);

      // Verify order is cancelled
      const order = await prisma.order.findUnique({ where: { id: rejectionOrderId } });
      expect(order?.status).toBe('CANCELLED');

      // Verify inventory was restored
      const batch = await prisma.batch.findUnique({ where: { id: batchId } });
      expect(batch?.quantity).toBe(100); // 90 + 10 restored

      // Verify transaction was logged
      const tx = await prisma.inventoryTransaction.findFirst({
        where: { batchId, referenceId: rejectionOrderId, transactionType: 'CANCELLATION' }
      });
      expect(tx).toBeDefined();
      expect(tx?.quantityDelta).toBe(10);
    });
  });
});
