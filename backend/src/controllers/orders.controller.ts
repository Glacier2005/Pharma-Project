import { initiateRefundIfPaid } from './payment.controller';
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthError } from "../middleware/auth.middleware";
import crypto from "node:crypto";

function qs(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class InsufficientStockError extends Error {
  constructor(message = "Insufficient stock for one or more items") {
    super(message);
    this.name = "InsufficientStockError";
  }
}

export class CheckoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutValidationError";
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order not found");
    this.name = "OrderNotFoundError";
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderItemInput = { medicineId: string; quantity: number };

const ORDER_ITEM_SELECT = {
  id: true,
  quantity: true,
  unit_price: true,
  medicineId: true,
  medicine: { select: { id: true, name: true, generic_name: true, price: true, requires_prescription: true } },
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mergeQuantities(items: OrderItemInput[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const item of items) {
    if (!item || typeof item !== "object") throw new CheckoutValidationError("Invalid order item");
    const { medicineId, quantity } = item;
    if (!medicineId || typeof medicineId !== "string") {
      throw new CheckoutValidationError("Each item must include a medicineId string");
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      throw new CheckoutValidationError("Each item must have a positive integer quantity");
    }
    const sum = (merged.get(medicineId) ?? 0) + quantity;
    if (sum > 2147483647) throw new CheckoutValidationError("Quantity is too large");
    merged.set(medicineId, sum);
  }
  return merged;
}

function resolvePharmacyId(
  rows: { pharmacyId: string; medicineId: string; stock_quantity: number }[],
  required: Map<string, number>,
): string | null {
  const byPharmacy = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let m = byPharmacy.get(row.pharmacyId);
    if (!m) {
      m = new Map();
      byPharmacy.set(row.pharmacyId, m);
    }
    m.set(row.medicineId, row.stock_quantity);
  }
  for (const [pharmacyId, stocks] of byPharmacy) {
    const ok = [...required.entries()].every(([id, qty]) => (stocks.get(id) ?? 0) >= qty);
    if (ok) return pharmacyId;
  }
  return null;
}

function formatOrder(order: {
  id: string;
  customerId: string;
  pharmacyId: string;
  status: string;
  total_amount: Prisma.Decimal;
  createdAt: Date;
  riderId?: string | null;
  is_emergency?: boolean;
  rating?: number | null;
  feedback?: string | null;
  pharmacy?: unknown;
  rider?: unknown;
  // Delivery details
  delivery_address?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  orderItems?: {
    id: string;
    quantity: number;
    unit_price: Prisma.Decimal;
    medicine: { id: string; name: string; generic_name: string };
  }[];
}) {
  return {
    id: order.id,
    customerId: order.customerId,
    riderId: order.riderId,
    is_emergency: order.is_emergency ?? false,
    rating: order.rating,
    feedback: order.feedback,
    pharmacy: order.pharmacy,
    rider: order.rider,
    pharmacyId: order.pharmacyId,
    status: order.status,
    total_amount: order.total_amount.toString(),
    createdAt: order.createdAt,

    // 👉 2. Send the new fields to the Frontend
    delivery_address: order.delivery_address,
    delivery_lat: order.delivery_lat,
    delivery_lng: order.delivery_lng,

    ...(order.orderItems
      ? {
          orderItems: order.orderItems.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            unit_price: item.unit_price.toString(),
            medicineId: item.medicine.id,
            medicine: item.medicine,
          })),
        }
      : {}),
  };
}
// ─── Controllers ─────────────────────────────────────────────────────────────

// POST /api/orders
export async function createOrder(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const { items, promoCode, delivery_address, delivery_lat, delivery_lng, is_emergency } = req.body as {
    items: Array<{ medicineId: string; quantity: number }>;
    promoCode?: string;
    delivery_address?: string;
    delivery_lat?: number;
    delivery_lng?: number;
    is_emergency?: boolean;
  };

  if (!Array.isArray(items) || items.length === 0) {
    throw new CheckoutValidationError("items must be a non-empty array");
  }

  if (delivery_lat !== undefined && (typeof delivery_lat !== "number" || delivery_lat < -90 || delivery_lat > 90)) {
    throw new CheckoutValidationError("Invalid delivery_lat");
  }
  if (delivery_lng !== undefined && (typeof delivery_lng !== "number" || delivery_lng < -180 || delivery_lng > 180)) {
    throw new CheckoutValidationError("Invalid delivery_lng");
  }

  if (promoCode !== undefined && typeof promoCode !== "string") throw new CheckoutValidationError("Invalid promoCode");
  if (delivery_address !== undefined && typeof delivery_address !== "string") throw new CheckoutValidationError("Invalid delivery_address");
  if (is_emergency !== undefined && typeof is_emergency !== "boolean") throw new CheckoutValidationError("Invalid is_emergency");
  const merged = mergeQuantities(items);
  const medicineIds = [...merged.keys()];
  const customerId = req.user.id;

  const order = await prisma.$transaction(
    async (tx) => {
      const customer = await tx.user.findUnique({ where: { id: customerId } });
      if (!customer) throw new CheckoutValidationError("Customer not found");

      const validBatches = await tx.batch.findMany({
        where: {
          inventory: { medicineId: { in: medicineIds } },
          expiryDate: { gt: new Date() },
          quantity: { gt: 0 }
        },
        include: { inventory: { select: { pharmacyId: true, medicineId: true } } },
        orderBy: { expiryDate: "asc" }
      });

      const aggregatedStock: { pharmacyId: string; medicineId: string; stock_quantity: number }[] = [];
      const stockMap = new Map<string, number>(); // key: pharmacyId_medicineId
      for (const b of validBatches) {
        const key = `${b.inventory.pharmacyId}_${b.inventory.medicineId}`;
        stockMap.set(key, (stockMap.get(key) ?? 0) + b.quantity);
      }
      for (const [key, qty] of stockMap.entries()) {
        const [pharmacyId, medicineId] = key.split('_');
        aggregatedStock.push({ pharmacyId, medicineId, stock_quantity: qty });
      }

      const pharmacyId = resolvePharmacyId(aggregatedStock, merged);
      if (!pharmacyId) throw new InsufficientStockError("No pharmacy can fulfill this order due to insufficient valid batch stock.");

      const medicines = await tx.medicine.findMany({
        where: { id: { in: medicineIds } },
        select: { id: true, price: true, requires_prescription: true },
      });
      if (medicines.length !== medicineIds.length) {
        throw new CheckoutValidationError("One or more medicines were not found");
      }

      let total = new Prisma.Decimal(0);
      const priceById = new Map(medicines.map((m) => [m.id, m.price]));
      for (const [medicineId, qty] of merged) {
        const price = priceById.get(medicineId);
        if (!price) throw new CheckoutValidationError("One or more medicines were not found");
        total = total.plus(price.mul(qty));
      }

      const deliveryFee = total.gte(499) ? 0 : 29;
      let discountAmount = new Prisma.Decimal(0);
      if (promoCode) {
        const promo = await tx.promoCode.findUnique({ where: { code: promoCode } });
        if (!promo || !promo.active || (promo.expiresAt && promo.expiresAt < new Date())) {
          throw new CheckoutValidationError("Invalid or expired promo code");
        }
        discountAmount = total.mul(promo.discountPercent).div(100).toDecimalPlaces(2);
        total = total.minus(discountAmount);
        if (total.lt(0)) total = new Prisma.Decimal(0);
      }

      total = total.plus(deliveryFee).plus(is_emergency ? 99 : 0);

      const needsPrescription = medicines.some(m => m.requires_prescription);

      // 1. Create order first so we have orderItem IDs
      const orderRecord = await tx.order.create({
        data: {
          customerId,
          pharmacyId,
          total_amount: total,
          status: needsPrescription ? "PRESCRIPTION_PENDING" : "PAYMENT_PENDING",
          is_emergency: is_emergency ?? false,
          delivery_address,
          delivery_lat,
          delivery_lng,
          orderItems: {
            create: [...merged.entries()].map(([medicineId, quantity]) => ({
              medicineId,
              quantity,
              unit_price: priceById.get(medicineId)!,
            })),
          },
        },
        include: { orderItems: true },
      });

      // 2. Perform FEFO Allocation
      const allocationsToCreate: { orderItemId: string, batchId: string, quantity: number }[] = [];
      const transactionsToCreate: { batchId: string, quantityDelta: number, transactionType: any, referenceId: string, performedById: string }[] = [];

      const pharmacyBatches = validBatches.filter(b => b.inventory.pharmacyId === pharmacyId);

      for (const orderItem of orderRecord.orderItems) {
        let remainingQty = orderItem.quantity;
        const medicineBatches = pharmacyBatches.filter(b => b.inventory.medicineId === orderItem.medicineId);

        for (const batch of medicineBatches) {
          if (remainingQty <= 0) break;
          const consume = Math.min(batch.quantity, remainingQty);

          allocationsToCreate.push({ orderItemId: orderItem.id, batchId: batch.id, quantity: consume });
          transactionsToCreate.push({
            batchId: batch.id,
            quantityDelta: -consume,
            transactionType: "ORDER",
            referenceId: orderRecord.id,
            performedById: customerId
          });

          remainingQty -= consume;
          batch.quantity -= consume; // Update memory for next iter if needed (though we break if remainingQty 0)
        }

        if (remainingQty > 0) {
           throw new InsufficientStockError(`Failed to allocate batch stock for medicine ${orderItem.medicineId}. Concurrent modification might have occurred.`);
        }
      }

      // 3. Atomically deduct batches and create records
      for (const alloc of allocationsToCreate) {
        const updateResult = await tx.batch.updateMany({
          where: { id: alloc.batchId, quantity: { gte: alloc.quantity } },
          data: { quantity: { decrement: alloc.quantity } }
        });
        if (updateResult.count === 0) {
          throw new InsufficientStockError("Concurrent checkout depleted a required batch. Please try again.");
        }
      }

      await tx.orderItemBatchAllocation.createMany({ data: allocationsToCreate });
      await tx.inventoryTransaction.createMany({ data: transactionsToCreate });

      const finalOrder = await tx.order.findUnique({
        where: { id: orderRecord.id },
        include: { orderItems: { select: ORDER_ITEM_SELECT } }
      });

      if (process.env.NODE_ENV === "test" && (req.body as any).forceTransactionError) {
        throw new Error("Simulated Database Failure");
      }

      return finalOrder!;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 30000,
      timeout: 30000,
    },
  );

  res.status(201).json({ order: formatOrder(order) });
}

// GET /api/orders
export async function listOrders(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const page  = Math.max(1, parseInt(qs(req.query.page) ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(qs(req.query.limit) ?? "20", 10) || 20));
  const skip  = (page - 1) * limit;
  const statusFilter = qs(req.query.status) as
    | "PRESCRIPTION_PENDING" | "PAYMENT_PENDING" | "PENDING" | "ACCEPTED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED"
    | undefined;

  if (statusFilter && !["PRESCRIPTION_PENDING", "PAYMENT_PENDING", "PENDING", "ACCEPTED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].includes(statusFilter)) {
    throw new CheckoutValidationError("Invalid order status");
  }
  const isStaff = ["PHARMACY_ADMIN", "PHARMACIST"].includes(req.user.role);
  if (isStaff && !req.user.pharmacyId) throw new AuthError("No pharmacy assigned", 403);
  // Scope orders to the authenticated user or pharmacy.
  const canSeeAll = req.user.role === "ADMIN";
  const isRider = req.user.role === "RIDER";
  const where = {
    ...(canSeeAll ? {} : isRider ? {
      OR: [
        { status: "PENDING" as any },
        { riderId: req.user.id }
      ]
    } : isStaff ? { pharmacyId: req.user.pharmacyId } : { customerId: req.user.id }),
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip,
      take: limit,
      orderBy: isRider ? [{ is_emergency: "desc" }, { createdAt: "asc" }] : [{ createdAt: "desc" }],
      include: { orderItems: { select: ORDER_ITEM_SELECT }, pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } } },
    }),
    prisma.order.count({ where }),
  ]);

  res.json({
    data: orders.map(formatOrder),
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

// GET /api/orders/:id
export async function getOrder(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const id = String(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      orderItems: { select: ORDER_ITEM_SELECT },
      pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } },
      rider: { select: { id: true, full_name: true, phone_number: true } },
    },
  });

  if (!order) throw new OrderNotFoundError();

  // Customers can only see their own orders
  if (req.user.role === "CUSTOMER" && order.customerId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (req.user.role === "RIDER" && order.riderId !== req.user.id && order.status !== "PENDING") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (["PHARMACY_ADMIN", "PHARMACIST"].includes(req.user.role) && order.pharmacyId !== req.user.pharmacyId) {
    throw new AuthError("Forbidden", 403);
  }
  res.json({ order: formatOrder(order) });
}

// PATCH /api/orders/:id/status   body: { status }
export async function updateOrderStatus(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const id = String(req.params.id);
  const { status } = req.body as { status?: string };

  const validTransitions: Record<string, string[]> = {
    PRESCRIPTION_PENDING: ["PAYMENT_PENDING", "CANCELLED"],
    PAYMENT_PENDING: ["PENDING", "CANCELLED"],
    PENDING: ["ACCEPTED", "CANCELLED"],
    ACCEPTED: ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: ["DELIVERED"],
    DELIVERED: [],
    CANCELLED: [],
  };

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new OrderNotFoundError();

  if (!status || !(status in validTransitions)) {
    res.status(400).json({
      error: "Invalid status. Must be one of: PRESCRIPTION_PENDING, PAYMENT_PENDING, PENDING, ACCEPTED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED",
    });
    return;
  }

  const allowed = validTransitions[order.status];
  if (order.status === 'CANCELLED' && status === 'CANCELLED' &&
      (req.user.role === 'ADMIN' || order.customerId === req.user.id || order.riderId === req.user.id)) {
    await initiateRefundIfPaid(id, req.user.id);
    res.json({ order: formatOrder(order) });
    return;
  }
  if (!allowed.includes(status)) {
    res.status(409).json({
      error: `Cannot transition from ${order.status} to ${status}. Allowed: ${allowed.join(", ") || "none"}`,
    });
    return;
  }

  if (req.user.role === "CUSTOMER") {
    if (order.customerId !== req.user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (status !== "CANCELLED") {
      res.status(403).json({ error: "Customers can only cancel orders" });
      return;
    }
  }

  let extraData: any = {};
  if (status === "ACCEPTED" && req.user.role === "RIDER") {
    const updatedBatch = await prisma.$transaction(async tx => {
      // Serialise claims by the same rider, even when two different orders are claimed.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user!.id} FOR UPDATE`;
      const active = await tx.order.findMany({
        where: { riderId: req.user!.id, status: { in: ["ACCEPTED", "OUT_FOR_DELIVERY"] } },
        select: { is_emergency: true },
      });
      if (active.some(o => o.is_emergency) || (order.is_emergency && active.length > 0)) {
        throw new InsufficientStockError("SOS requires a dedicated rider. Finish your active deliveries first.");
      }
      return tx.order.updateMany({
        where: { id, status: "PENDING", riderId: null },
        data: { status: "ACCEPTED", riderId: req.user!.id },
      });
    });
    if (updatedBatch.count === 0) {
      res.status(409).json({ error: "Order is already claimed by another rider or not pending." });
      return;
    }
    const updated = await prisma.order.findUnique({
      where: { id },
      include: { orderItems: { select: ORDER_ITEM_SELECT }, pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } } },
    });
    res.json({ order: formatOrder(updated!) });
    return;
  }

  if (req.user.role === "RIDER") {
    if (["OUT_FOR_DELIVERY", "CANCELLED"].includes(status)) {
      if (order.riderId !== req.user.id) {
         res.status(403).json({ error: "You cannot update an order assigned to someone else." });
         return;
      }
    }
  }

  if (status === "DELIVERED") {
    res.status(403).json({ error: "Cannot transition to DELIVERED directly. Use OTP verification." });
    return;
  }

  if (status === "CANCELLED") {
    const updatedOrder = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
      const currentOrder = await tx.order.findUnique({
        where: { id },
        include: { orderItems: { include: { allocations: true, medicine: true } } }
      });
      if (!currentOrder || currentOrder.status === "CANCELLED") {
         return currentOrder; // Idempotent: already cancelled, do nothing
      }

      if (!['PRESCRIPTION_PENDING', 'PAYMENT_PENDING', 'PENDING', 'ACCEPTED'].includes(currentOrder.status)) {
        throw new CheckoutValidationError('Order can no longer be cancelled');
      }
      const newOrder = await tx.order.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: { orderItems: { select: ORDER_ITEM_SELECT }, pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } } },
      });

      // Restore inventory
      const transactionsToCreate = [];
      for (const item of currentOrder.orderItems) {
        for (const alloc of item.allocations) {
           await tx.batch.update({
             where: { id: alloc.batchId },
             data: { quantity: { increment: alloc.quantity } }
           });
           transactionsToCreate.push({
             batchId: alloc.batchId,
             quantityDelta: alloc.quantity,
             transactionType: "CANCELLATION",
             referenceId: id,
             performedById: req.user!.id
           });
        }
      }

      if (transactionsToCreate.length > 0) {
         // Fix TypeScript issue: We use 'as any' for transactionType because the Prisma Client types might not have re-generated properly in the editor scope yet.
         await tx.inventoryTransaction.createMany({ data: transactionsToCreate as any });
      }

      return newOrder;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (!updatedOrder) throw new OrderNotFoundError();
    await initiateRefundIfPaid(id, req.user.id);
    res.json({ order: formatOrder(updatedOrder as any) });
    return;
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { status: status as "PRESCRIPTION_PENDING" | "PAYMENT_PENDING" | "PENDING" | "ACCEPTED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED", ...extraData },
    include: { orderItems: { select: ORDER_ITEM_SELECT }, pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } } },
  });

  res.json({ order: formatOrder(updated) });
}

// POST /api/orders/:id/payment   body: { method: "COD" | "MOCK_UPI" | "MOCK_CARD" }
export async function processPayment(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const id = String(req.params.id);
  const { method } = req.body as { method?: string };

  if (!method || !["COD", "MOCK_UPI", "MOCK_CARD"].includes(method)) {
    res.status(400).json({ error: "Invalid payment method" });
    return;
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new OrderNotFoundError();

  if (order.customerId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (order.status !== "PAYMENT_PENDING") {
    res.status(400).json({ error: "Order is not pending payment" });
    return;
  }

  // Simulate payment delay
  if (method !== "COD") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        amount: order.total_amount,
        method,
        status: "SUCCESS",
        transactionId: method === "COD" ? null : `TXN_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      },
    });

    return tx.order.update({
      where: { id: order.id },
      data: { status: "PENDING" },
      include: { orderItems: { select: ORDER_ITEM_SELECT }, pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } } },
    });
  });

  res.json({ order: formatOrder(updated) });
}

export async function submitOrderFeedback(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");
  const id = req.params.id as string;
  const { rating, feedback } = req.body as { rating: number; feedback?: string };

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be between 1 and 5" });
    return;
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new OrderNotFoundError();

  if (order.customerId !== req.user.id && req.user.role !== "ADMIN") {
    throw new AuthError("Unauthorized to rate this order", 403);
  }

  if (order.status !== "DELIVERED") {
    res.status(400).json({ error: "Can only rate delivered orders" });
    return;
  }

  const updated = await prisma.order.update({
    where: { id: id as string },
    data: { rating, feedback },
  });

  res.json({ success: true, order: formatOrder(updated) });
}



export async function requestDeliveryOtp(req: Request, res: Response): Promise<void> {
  if (!req.user || req.user.role !== "CUSTOMER") throw new AuthError("Unauthorized");
  const id = req.params.id as string;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new OrderNotFoundError();

  if (order.customerId !== req.user.id) {
    throw new AuthError("Unauthorized: Not your order", 403);
  }

  if (order.status !== "OUT_FOR_DELIVERY") {
    res.status(400).json({ error: "Order is not out for delivery." });
    return;
  }

  // Check cooldown (60 seconds)
  if (order.deliveryOtpIssuedAt && order.deliveryOtpExpiresAt && order.deliveryOtpExpiresAt > new Date()) {
    const timeSinceIssue = new Date().getTime() - order.deliveryOtpIssuedAt.getTime();
    if (timeSinceIssue < 60000) {
      res.status(429).json({ error: "OTP requested recently. Please wait before requesting again." });
      return;
    }
  }

  // Check if locked
  if (order.deliveryOtpAttempts >= 5) {
    res.status(423).json({ error: "OTP attempts exhausted. Please contact support." });
    return;
  }

  const otp = crypto.randomInt(100000, 1000000).toString();
  const hash = crypto.createHash("sha256").update(otp).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  await prisma.order.update({
    where: { id },
    data: {
      deliveryOtpHash: hash,
      deliveryOtpExpiresAt: expiresAt,
      deliveryOtpIssuedAt: new Date(),
      deliveryOtpAttempts: 0,
    },
  });

  // For development, we return the plaintext OTP once
  res.json({ success: true, otp });
}

export async function verifyDeliveryOtp(req: Request, res: Response): Promise<void> {
  if (!req.user || req.user.role !== "RIDER") throw new AuthError("Unauthorized");
  const id = req.params.id as string;
  const { otp } = req.body as { otp: string };

  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
    res.status(400).json({ error: "Invalid OTP format." });
    return;
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new OrderNotFoundError();

  if (order.riderId !== req.user.id) {
    throw new AuthError("Unauthorized: Not assigned to this order", 403);
  }

  if (order.status !== "OUT_FOR_DELIVERY") {
    res.status(400).json({ error: "Order is not out for delivery." });
    return;
  }

  if (order.deliveryOtpAttempts >= 5) {
    res.status(423).json({ error: "OTP locked due to too many failed attempts." });
    return;
  }

  if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt) {
    res.status(400).json({ error: "OTP was not requested by the customer." });
    return;
  }

  if (order.deliveryOtpExpiresAt < new Date()) {
    res.status(400).json({ error: "OTP has expired. Customer must request a new one." });
    return;
  }

  const hash = crypto.createHash("sha256").update(otp).digest("hex");

  if (hash !== order.deliveryOtpHash) {
    // Increment attempts atomically
    const updated = await prisma.order.update({
      where: { id, status: "OUT_FOR_DELIVERY" },
      data: { deliveryOtpAttempts: { increment: 1 } },
    });

    if (updated.deliveryOtpAttempts >= 5) {
      res.status(423).json({ error: "OTP locked due to too many failed attempts." });
    } else {
      res.status(400).json({ error: "Invalid OTP." });
    }
    return;
  }

  // Success - Atomic update
  const updated = await prisma.order.updateMany({
    where: {
      id,
      status: "OUT_FOR_DELIVERY",
      riderId: req.user.id,
      deliveryOtpAttempts: { lt: 5 },
      deliveryOtpHash: hash,
      deliveryOtpExpiresAt: { gt: new Date() }
    },
    data: {
      status: "DELIVERED",
      deliveryOtpVerifiedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    res.status(409).json({ error: "Failed to update order status. It may have been modified concurrently." });
    return;
  }

  const finalOrder = await prisma.order.findUnique({ where: { id } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.json({ success: true, order: formatOrder(finalOrder as any) });
}
