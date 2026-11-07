import type { Request, Response } from "express";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthError } from "../middleware/auth.middleware";
import { OrderNotFoundError } from "./orders.controller";
import { getRazorpayClient, isRazorpayMode } from "../services/RazorpayService";

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class PaymentError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "PaymentError";
    this.statusCode = statusCode;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a Decimal INR amount to integer paise.
 * Uses string manipulation to avoid floating-point imprecision.
 */
function toPaise(amount: Prisma.Decimal): number {
  // e.g. 100.50 -> "100.50" -> 10050
  const str = amount.toFixed(2);
  const [rupees, paise] = str.split(".");
  return parseInt(rupees, 10) * 100 + parseInt(paise, 10);
}

// ─── POST /api/orders/:id/payment ─────────────────────────────────────────────

export async function createPayment(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const orderId = String(req.params.id);

  // 1. Load order — authoritative amount ALWAYS comes from DB
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payment: true },
  });
  if (!order) throw new OrderNotFoundError();

  // 2. BOLA: customer must own this order
  if (order.customerId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // 3. Order must be in PAYMENT_PENDING
  if (order.status === "CANCELLED") {
    res.status(400).json({ error: "Cannot pay a cancelled order" });
    return;
  }
  if (order.status === "PRESCRIPTION_PENDING") {
    res.status(400).json({ error: "Cannot pay while prescription is pending pharmacist approval" });
    return;
  }
  if (order.status !== "PAYMENT_PENDING") {
    res.status(400).json({ error: "Order is not pending payment" });
    return;
  }

  // 4. Idempotency: already successfully paid?
  if (order.payment?.status === "SUCCESS") {
    res.status(400).json({ error: "Order has already been paid" });
    return;
  }

  const method = (req.body as { method?: string }).method ?? (isRazorpayMode() ? "RAZORPAY" : "COD");

  // ─── COD / Local Mode ───
  if (method === "COD" || !isRazorpayMode()) {
    if (!["COD", "MOCK_UPI", "MOCK_CARD"].includes(method)) {
      res.status(400).json({ error: "Invalid payment method" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      const current = await tx.order.findUnique({ where: { id: orderId } });
      if (!current || current.status !== 'PAYMENT_PENDING') throw new PaymentError('Order is no longer pending payment', 409);
      await tx.payment.upsert({
        where: { orderId },
        create: {
          orderId,
          amount: order.total_amount,
          method,
          status: "SUCCESS",
          provider: "LOCAL",
          transactionId: method === "COD" ? null : `LOCAL_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        },
        update: {
          status: "SUCCESS",
          method,
          transactionId: method === "COD" ? null : `LOCAL_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        },
      });
      return tx.order.update({
        where: { id: orderId },
        data: { status: "PENDING" },
      });
    });

    res.json({ order: { id: result.id, status: result.status } });
    return;
  }

  // ─── Razorpay Mode ───
  const razorpay = getRazorpayClient();

  // 5. If payment already exists with a providerOrderId, return it (idempotency)
  if (order.payment?.providerOrderId) {
    res.json({
      paymentId: order.payment.id,
      razorpayOrderId: order.payment.providerOrderId,
      amount: toPaise(order.total_amount),
      currency: "INR",
      keyId: process.env.RAZORPAY_KEY_ID,
    });
    return;
  }

  // 6. Create Razorpay order — amount is ALWAYS from Order.total_amount, never from frontend
  const paiseAmount = toPaise(order.total_amount);
  let razorpayOrder: { id: string; amount: number; currency: string };
  try {
    razorpayOrder = (await razorpay.orders.create({
      amount: paiseAmount,
      currency: "INR",
      receipt: orderId.slice(-20), // max 40 chars
      notes: { pharmadash_order_id: orderId },
    })) as { id: string; amount: number; currency: string };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[payment] Razorpay order creation failed for orderId=${orderId}: ${msg}`);
    res.status(502).json({ error: "Payment provider unavailable. Please try again." });
    return;
  }

  // 7. Persist the Razorpay order reference
  const payment = await prisma.payment.upsert({
    where: { orderId },
    create: {
      orderId,
      amount: order.total_amount,
      status: "PENDING",
      provider: "RAZORPAY",
      providerOrderId: razorpayOrder.id,
    },
    update: {
      providerOrderId: razorpayOrder.id,
      status: "PENDING",
      provider: "RAZORPAY",
    },
  });

  // 8. Return ONLY safe checkout information — NEVER expose KEY_SECRET
  res.json({
    paymentId: payment.id,
    razorpayOrderId: razorpayOrder.id,
    amount: paiseAmount,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
  });
}

// ─── POST /api/webhooks/razorpay ──────────────────────────────────────────────

export async function handleRazorpayWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["x-razorpay-signature"];

  // 1. Signature must be present
  if (!signature || typeof signature !== "string") {
    console.warn("[webhook] Missing X-Razorpay-Signature");
    res.status(400).json({ error: "Missing webhook signature" });
    return;
  }

  // 2. Verify webhook signature against EXACT raw body
  //    req.body is the raw Buffer captured before express.json()
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[webhook] RAZORPAY_WEBHOOK_SECRET not configured");
    res.status(500).json({ error: "Webhook not configured" });
    return;
  }

  const rawBody: Buffer = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    console.error("[webhook] Raw body is not a Buffer — check Express middleware order");
    res.status(500).json({ error: "Webhook configuration error" });
    return;
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  let signatureValid = false;
  if (sigBuffer.length === expectedBuffer.length) {
    signatureValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  }

  if (!signatureValid) {
    console.warn("[webhook] Invalid signature — rejecting");
    res.status(400).json({ error: "Invalid webhook signature" });
    return;
  }

  // 3. Parse payload (now we trust it)
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    console.warn("[webhook] Malformed JSON payload");
    res.status(400).json({ error: "Malformed payload" });
    return;
  }

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Malformed payload' });
    return;
  }
  const event = payload.event as string | undefined;
  console.log(`[webhook] Received event: ${event}`);

  // 4. Handle order.paid event
  if (event === "order.paid") {
    await handleOrderPaid(payload);
  }
  // Additional events can be added here (e.g. payment.failed)

  // Always return 200 to acknowledge receipt — Razorpay will retry on non-200
  res.status(200).json({ ok: true });
}

// ─── handleOrderPaid — idempotent payment confirmation ────────────────────────

async function handleOrderPaid(payload: Record<string, unknown>): Promise<void> {
  try {
    const payloadPayment = (payload.payload as Record<string, unknown>)?.payment as Record<string, unknown> | undefined;
    const paymentEntity = payloadPayment?.entity as Record<string, unknown> | undefined;

    if (!paymentEntity) {
      console.warn("[webhook] order.paid: missing payment.entity in payload");
      return;
    }

    const razorpayOrderId = paymentEntity.order_id as string | undefined;
    const razorpayPaymentId = paymentEntity.id as string | undefined;
    const webhookAmount = paymentEntity.amount as number | undefined; // in paise
    const webhookCurrency = paymentEntity.currency as string | undefined;

    if (!razorpayOrderId || !razorpayPaymentId) {
      console.warn("[webhook] order.paid: missing order_id or payment_id");
      return;
    }

    // 1. Find the internal Payment record by providerOrderId
    const payment = await prisma.payment.findUnique({
      where: { providerOrderId: razorpayOrderId },
      include: { order: true },
    });

    if (!payment) {
      console.warn(`[webhook] order.paid: no payment found for providerOrderId=${razorpayOrderId}`);
      return;
    }

    // 2. IDEMPOTENCY: already processed? Do nothing.
    if (payment.status !== "PENDING") {
      console.log(`[webhook] order.paid: already processed paymentId=${payment.id} — skipping`);
      return;
    }

    // 3. Currency validation
    if (webhookCurrency !== "INR" || paymentEntity.status !== "captured") {
      console.error(`[webhook] order.paid: unexpected currency ${webhookCurrency} for paymentId=${payment.id}`);
      return;
    }

    // 4. Amount validation — webhook amount (paise) must match DB amount (INR)
    if (!Number.isSafeInteger(webhookAmount) || Number(webhookAmount) < 1) return;
    {
      const expectedPaise = toPaise(payment.amount);
      if (webhookAmount !== expectedPaise) {
        console.error(
          `[webhook] order.paid: amount mismatch — expected ${expectedPaise} paise, got ${webhookAmount} for paymentId=${payment.id}`
        );
        return;
      }
    }

    // 5. Atomically update Payment and Order
    await prisma.$transaction(async (tx) => {
      // Re-check inside transaction for race safety
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
      const freshPayment = await tx.payment.findUnique({ where: { id: payment.id } });
      if (!freshPayment || freshPayment.status !== "PENDING") return; // Already done by concurrent webhook

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCESS",
          transactionId: razorpayPaymentId,
          method: "RAZORPAY",
        },
      });

      // Only transition order if it's still PAYMENT_PENDING
      if (payment.order.status === "PAYMENT_PENDING") {
        await tx.order.updateMany({
          where: { id: payment.orderId, status: 'PAYMENT_PENDING' },
          data: { status: "PENDING" },
        });
      }
    });

    console.log(`[webhook] order.paid: payment ${payment.id} → SUCCESS, order ${payment.orderId} → PENDING`);
  } catch (err) {
    // Return a retryable response; acknowledging failures would lose payments.
    console.error("[webhook] order.paid: processing error:", err instanceof Error ? err.message : err);
    throw new PaymentError("Payment confirmation temporarily unavailable", 503);
  }
}

// ─── Refund helper (called by cancellation logic) ────────────────────────────

export async function initiateRefundIfPaid(orderId: string, cancelledById: string): Promise<void> {
  if (!isRazorpayMode()) return; // Only relevant in Razorpay mode

  const payment = await prisma.payment.findUnique({ where: { orderId } });

  // No payment, not paid, or refund already issued — skip
  if (!payment || payment.provider !== "RAZORPAY" || payment.status !== "SUCCESS" || !payment.transactionId) return;
  if (payment.refundId) {
    console.log(`[refund] Already refunded for orderId=${orderId} refundId=${payment.refundId}`);
    return;
  }

  const razorpay = getRazorpayClient();
  const claimed = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'SUCCESS', refundId: null },
    data: { status: 'REFUND_PENDING' },
  });
  if (!claimed.count) return;
  try {
    const refund = await razorpay.payments.refund(payment.transactionId, {
      speed: "normal",
      notes: { reason: "Order cancelled by user", pharmadash_order_id: orderId, cancelled_by: cancelledById },
    }) as { id: string };

    // Idempotency: store refund ID so duplicate cancellations don't issue double refunds
    await prisma.payment.update({
      where: { id: payment.id },
      data: { refundId: refund.id, status: "REFUNDED" },
    });

    console.log(`[refund] Initiated refund ${refund.id} for orderId=${orderId}`);
  } catch (err) {
    // Keep REFUND_PENDING on ambiguous network failure so retries cannot double-refund.
    // Reconcile this state with the provider before retrying.
    console.error(`[refund] Failed to issue refund for orderId=${orderId}:`, err instanceof Error ? err.message : err);
  }
}
