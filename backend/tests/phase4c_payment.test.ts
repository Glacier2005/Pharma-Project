/**
 * Phase 4C — Payment Security & Razorpay Integration Tests
 *
 * Tests: Authentication, BOLA, order-state gating, amount security,
 *        webhook signature verification, webhook idempotency,
 *        refund idempotency, COD/local mode compatibility.
 *
 * These tests run against the real database. All test data is isolated
 * using unique phone numbers and cleaned up in afterAll.
 */

import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/index';
import { prisma } from '../src/db/prisma';
import { signToken } from '../src/lib/jwt';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWebhookBody(razorpayOrderId: string, paymentId: string, amountPaise: number) {
  return {
    event: 'order.paid',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: razorpayOrderId,
          amount: amountPaise,
          currency: 'INR',
          status: 'captured',
        }
      }
    }
  };
}

function signWebhookPayload(body: object, secret: string): string {
  const raw = JSON.stringify(body);
  return crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe('Phase 4C — Payment Security & Integration', () => {
  let customerToken: string;
  let customerId: string;
  let otherCustomerToken: string;
  let otherCustomerId: string;
  let pharmacyId: string;
  let medicineId: string;

  // Store IDs for cleanup
  const createdOrderIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdPharmacyIds: string[] = [];
  const createdMedicineIds: string[] = [];

  // Use a fixed webhook secret for tests (matches what the route will use when env var is set)
  const WEBHOOK_SECRET = 'test_webhook_secret_phase4c';

  beforeAll(async () => {
    // Set webhook secret in env for tests
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    // Ensure local mode for most tests (no real Razorpay calls)
    process.env.PAYMENT_PROVIDER = 'local';

    const pharmacy = await prisma.pharmacy.create({
      data: { name: `Test Payment Pharmacy ${Date.now()}`, latitude: 0, longitude: 0 }
    });
    pharmacyId = pharmacy.id;
    createdPharmacyIds.push(pharmacyId);

    const medicine = await prisma.medicine.create({
      data: {
        name: `Test Payment Med ${Date.now()}`,
        generic_name: 'GenPay',
        price: 100.50, // ₹100.50 = 10050 paise
        manufacturer: 'TestCo',
        requires_prescription: false,
      }
    });
    medicineId = medicine.id;
    createdMedicineIds.push(medicineId);

    const inventory = await prisma.inventory.create({
      data: { pharmacyId, medicineId }
    });
    const batch = await prisma.batch.create({
      data: {
        inventoryId: inventory.id,
        batchNumber: `PAY-TEST-BATCH-${Date.now()}`,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        quantity: 200,
      }
    });

    const customer = await prisma.user.create({
      data: {
        role: 'CUSTOMER',
        phone_number: `+91901${Date.now().toString().slice(-7)}`,
        full_name: 'Pay Test Customer',
        password_hash: 'hash'
      }
    });
    customerId = customer.id;
    createdUserIds.push(customerId);
    customerToken = signToken({ sub: customerId, role: 'CUSTOMER' });

    const otherCustomer = await prisma.user.create({
      data: {
        role: 'CUSTOMER',
        phone_number: `+91902${Date.now().toString().slice(-7)}`,
        full_name: 'Other Pay Customer',
        password_hash: 'hash'
      }
    });
    otherCustomerId = otherCustomer.id;
    createdUserIds.push(otherCustomerId);
    otherCustomerToken = signToken({ sub: otherCustomerId, role: 'CUSTOMER' });
  });

  afterAll(async () => {
    // Clean up in dependency order
    await prisma.payment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.orderItemBatchAllocation.deleteMany({ where: { orderItem: { orderId: { in: createdOrderIds } } } });
    await prisma.inventoryTransaction.deleteMany({ where: { referenceId: { in: createdOrderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    // Cascade should handle inventory/batch on pharmacy delete
    await prisma.pharmacy.deleteMany({ where: { id: { in: createdPharmacyIds } } });
    await prisma.medicine.deleteMany({ where: { id: { in: createdMedicineIds } } });
  });

  // ─── Helper to create a test order ──────────────────────────────────────────

  async function createTestOrder(status: 'PAYMENT_PENDING' | 'PRESCRIPTION_PENDING' | 'CANCELLED' | 'PENDING' = 'PAYMENT_PENDING') {
    const order = await prisma.order.create({
      data: {
        customerId,
        pharmacyId,
        total_amount: new (await import('@prisma/client')).Prisma.Decimal(100.50),
        status,
        delivery_address: '123 Test St',
      }
    });
    createdOrderIds.push(order.id);
    return order;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Authentication', () => {
    it('rejects unauthenticated payment requests', async () => {
      const order = await createTestOrder();
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .send({});
      expect(res.status).toBe(401);
    });

    it('rejects non-customer roles from payment endpoint', async () => {
      const order = await createTestOrder();
      const riderToken = signToken({ sub: 'rider-id', role: 'RIDER' });
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${riderToken}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — BOLA (Broken Object Level Authorization)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BOLA Protection', () => {
    it('prevents customer from paying another customers order', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/forbidden/i);
    });

    it('allows customer to pay their own PAYMENT_PENDING order', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — ORDER STATE MACHINE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Order State Gating', () => {
    it('rejects payment on PRESCRIPTION_PENDING order', async () => {
      const order = await createTestOrder('PRESCRIPTION_PENDING');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/prescription/i);
    });

    it('rejects payment on CANCELLED order', async () => {
      const order = await createTestOrder('CANCELLED');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cancelled/i);
    });

    it('rejects payment on already-PENDING (paid) order', async () => {
      const order = await createTestOrder('PENDING');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      expect(res.status).toBe(400);
    });

    it('rejects already-paid order (Payment.status = SUCCESS)', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      // Create a SUCCESS payment record
      await prisma.payment.create({
        data: { orderId: order.id, amount: 100.50, method: 'COD', status: 'SUCCESS', provider: 'LOCAL' }
      });
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already been paid/i);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — AMOUNT SECURITY (frontend amount must be ignored)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Amount Security', () => {
    it('uses database Order.total_amount regardless of any frontend-supplied amount', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');

      // Attacker sends manipulated amount = 1 paise
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ amount: 1, method: 'COD' });

      expect(res.status).toBe(200);

      // Verify the payment was recorded at the correct DB amount (₹100.50)
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      expect(payment).not.toBeNull();
      expect(Number(payment!.amount)).toBeCloseTo(100.50, 2);
    });

    it('ignores any price field sent in the body', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ price: 0.01, total: 0.01, method: 'COD' });

      expect(res.status).toBe(200);
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      expect(Number(payment!.amount)).toBeCloseTo(100.50, 2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — WEBHOOK SIGNATURE SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Webhook Signature Security', () => {
    const webhookUrl = '/api/webhooks/razorpay';

    it('rejects webhook with missing signature', async () => {
      const body = makeWebhookBody('rz_ord_abc', 'rz_pay_abc', 10050);
      const res = await request(app)
        .post(webhookUrl)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(body));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/i);
    });

    it('rejects webhook with invalid (tampered) signature', async () => {
      const body = makeWebhookBody('rz_ord_abc', 'rz_pay_abc', 10050);
      const res = await request(app)
        .post(webhookUrl)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', 'deadbeefdeadbeef')
        .send(JSON.stringify(body));
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/i);
    });

    it('accepts webhook with valid signature', async () => {
      // Create a payment record that matches the providerOrderId
      const order = await createTestOrder('PAYMENT_PENDING');
      await prisma.payment.create({
        data: {
          orderId: order.id,
          amount: 100.50,
          status: 'PENDING',
          provider: 'RAZORPAY',
          providerOrderId: `rz_ord_valid_${order.id}`,
        }
      });

      const body = makeWebhookBody(`rz_ord_valid_${order.id}`, `rz_pay_valid_${order.id}`, 10050);
      const rawBody = JSON.stringify(body);
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

      const res = await request(app)
        .post(webhookUrl)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sig)
        .send(rawBody);
      expect(res.status).toBe(200);
    });

    it('rejects malformed JSON payload', async () => {
      const rawBody = '{ invalid json }';
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
      const res = await request(app)
        .post(webhookUrl)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sig)
        .send(rawBody);
      expect(res.status).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — WEBHOOK IDEMPOTENCY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Webhook Idempotency', () => {
    const webhookUrl = '/api/webhooks/razorpay';

    it('delivers the same order.paid webhook 3 times without duplicating effects', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      const rzOrderId = `rz_ord_idem_${order.id}`;
      const rzPayId = `rz_pay_idem_${order.id}`;

      await prisma.payment.create({
        data: {
          orderId: order.id,
          amount: 100.50,
          status: 'PENDING',
          provider: 'RAZORPAY',
          providerOrderId: rzOrderId,
        }
      });

      const body = makeWebhookBody(rzOrderId, rzPayId, 10050);
      const rawBody = JSON.stringify(body);
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

      // Send 3 times
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post(webhookUrl)
          .set('Content-Type', 'application/json')
          .set('X-Razorpay-Signature', sig)
          .send(rawBody);
        expect(res.status).toBe(200);
      }

      // Only ONE payment record should exist with SUCCESS
      const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
      expect(payments).toHaveLength(1);
      expect(payments[0].status).toBe('SUCCESS');
      expect(payments[0].transactionId).toBe(rzPayId);

      // Order should be PENDING (not duplicated to some other state)
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(updatedOrder!.status).toBe('PENDING');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7 — WEBHOOK PAYMENT CONSISTENCY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Webhook Payment Consistency', () => {
    const webhookUrl = '/api/webhooks/razorpay';

    it('ignores order.paid for unknown Razorpay order ID', async () => {
      const body = makeWebhookBody('rz_ord_nonexistent_xyz', 'rz_pay_abc', 10050);
      const rawBody = JSON.stringify(body);
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

      const res = await request(app)
        .post(webhookUrl)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sig)
        .send(rawBody);
      // Should still return 200 (Razorpay should not retry)
      expect(res.status).toBe(200);
    });

    it('rejects order.paid with mismatched currency', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      const rzOrderId = `rz_ord_currency_${order.id}`;

      await prisma.payment.create({
        data: {
          orderId: order.id,
          amount: 100.50,
          status: 'PENDING',
          provider: 'RAZORPAY',
          providerOrderId: rzOrderId,
        }
      });

      const body = {
        event: 'order.paid',
        payload: {
          payment: {
            entity: {
              id: `rz_pay_cur_${order.id}`,
              order_id: rzOrderId,
              amount: 10050,
              currency: 'USD', // Wrong currency
              status: 'captured',
            }
          }
        }
      };
      const rawBody = JSON.stringify(body);
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

      const res = await request(app)
        .post(webhookUrl)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sig)
        .send(rawBody);
      expect(res.status).toBe(200); // Webhook acknowledged

      // Payment should NOT be SUCCESS
      const payment = await prisma.payment.findUnique({ where: { providerOrderId: rzOrderId } });
      expect(payment!.status).toBe('PENDING');
    });

    it('rejects order.paid with mismatched amount', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      const rzOrderId = `rz_ord_amt_${order.id}`;

      await prisma.payment.create({
        data: {
          orderId: order.id,
          amount: 100.50, // 10050 paise
          status: 'PENDING',
          provider: 'RAZORPAY',
          providerOrderId: rzOrderId,
        }
      });

      // Attacker sends manipulated paise amount
      const body = makeWebhookBody(rzOrderId, `rz_pay_amt_${order.id}`, 1); // 1 paise instead of 10050
      const rawBody = JSON.stringify(body);
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');

      const res = await request(app)
        .post(webhookUrl)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', sig)
        .send(rawBody);
      expect(res.status).toBe(200);

      const payment = await prisma.payment.findUnique({ where: { providerOrderId: rzOrderId } });
      expect(payment!.status).toBe('PENDING'); // NOT SUCCESS
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8 — REFUND IDEMPOTENCY (Local mode — no real Razorpay calls)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Refund Idempotency', () => {
    it('does not attempt refund for unpaid order cancellation', async () => {
      // Create order that was never paid
      const order = await createTestOrder('PAYMENT_PENDING');
      // No Payment record = no refund should be triggered
      // Cancel the order via updateOrderStatus (requires ADMIN or customer)
      const adminToken = signToken({ sub: 'admin-id', role: 'ADMIN' });
      const res = await request(app)
        .patch(`/api/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CANCELLED' });
      expect(res.status).toBe(200);
      // Payment record should not exist
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      expect(payment).toBeNull();
    });

    it('does not create duplicate refund if refundId already exists', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      // Simulate already-refunded payment
      await prisma.payment.create({
        data: {
          orderId: order.id,
          amount: 100.50,
          method: 'RAZORPAY',
          status: 'REFUNDED',
          provider: 'RAZORPAY',
          transactionId: 'rz_pay_already_refunded',
          refundId: 'rz_rfnd_already_exists',
        }
      });
      // initiateRefundIfPaid should detect existing refundId and skip
      const { initiateRefundIfPaid } = await import('../src/controllers/payment.controller');
      await expect(initiateRefundIfPaid(order.id, customerId)).resolves.not.toThrow();

      // refundId should remain unchanged
      const payment = await prisma.payment.findUnique({ where: { orderId: order.id } });
      expect(payment!.refundId).toBe('rz_rfnd_already_exists');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9 — LOCAL COD MODE REGRESSION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Local/COD Mode Regression', () => {
    it('completes COD payment without Razorpay credentials', async () => {
      // PAYMENT_PROVIDER=local is set in beforeAll
      const order = await createTestOrder('PAYMENT_PENDING');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      expect(res.status).toBe(200);
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(updatedOrder!.status).toBe('PENDING');
    });

    it('transitions order from PAYMENT_PENDING → PENDING after COD', async () => {
      const order = await createTestOrder('PAYMENT_PENDING');
      await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(updatedOrder!.status).toBe('PENDING');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10 — PRESCRIPTION WORKFLOW REGRESSION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Prescription Workflow Regression', () => {
    it('prevents payment while order is in PRESCRIPTION_PENDING state', async () => {
      const order = await createTestOrder('PRESCRIPTION_PENDING');
      const res = await request(app)
        .post(`/api/orders/${order.id}/payment`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ method: 'COD' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/prescription/i);
    });
  });
});
