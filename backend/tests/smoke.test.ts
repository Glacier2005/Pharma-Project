import request from "supertest";
import { Prisma } from "@prisma/client";
jest.mock("../src/services/OcrService", () => ({ OcrService: { extractText: jest.fn() } }));
import { OcrService } from "../src/services/OcrService";

jest.mock("../src/db/prisma", () => ({ prisma: {
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  user: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  medicine: { findMany: jest.fn() },
  pharmacy: { findMany: jest.fn() },
  order: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  inventory: { findMany: jest.fn(), count: jest.fn() },
} }));
import { app } from "../src/index";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/lib/jwt";

const token = (role = "CUSTOMER", pharmacyId?: string) => signToken({ sub: "customer", role, pharmacyId });
const auth = (role = "CUSTOMER", pharmacyId?: string) => `Bearer ${token(role, pharmacyId)}`;
const order = {
  id: "order", customerId: "customer", pharmacyId: "pharmacy", riderId: "rider",
  status: "PENDING", total_amount: new Prisma.Decimal(20), createdAt: new Date(),
  rating: 4, feedback: "Good", delivery_address: "Test address", delivery_lat: 0, delivery_lng: 0,
  pharmacy: { id: "pharmacy", name: "Test pharmacy", latitude: 0, longitude: 0 },
  rider: { id: "rider", full_name: "Test rider" }, deliveryOtpHash: "must-never-leak",
  orderItems: [{ id: "item", medicineId: "medicine", quantity: 2, unit_price: new Prisma.Decimal(10),
    medicine: { id: "medicine", name: "Test medicine", generic_name: "Generic", price: new Prisma.Decimal(10), requires_prescription: true } }],
};

beforeEach(() => jest.clearAllMocks());

describe("API smoke (isolated database mock)", () => {
  test("health reports a working database", async () => {
    (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ result: 1 }]);
    expect((await request(app).get("/health")).body.ok).toBe(true);
  });
  test("health reports unavailable database", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      (prisma.$queryRaw as jest.Mock).mockRejectedValue(new Error("offline"));
      expect((await request(app).get("/health")).status).toBe(503);
    } finally { log.mockRestore(); }
  });
  test.each(["/api/orders", "/api/inventory", "/api/users/me", "/api/admin/analytics", "/api/prescriptions/pending"])("%s requires login", async path => {
    expect((await request(app).get(path)).status).toBe(401);
  });
  test.each(["/api/inventory", "/api/users", "/api/admin/analytics", "/api/prescriptions/pending"])("customer cannot access %s", async path => {
    expect((await request(app).get(path).set("Authorization", auth())).status).toBe(403);
  });
  test("invalid token is rejected", async () => {
    expect((await request(app).get("/api/orders").set("Authorization", "Bearer invalid")).status).toBe(401);
  });
  test("malformed JSON is a client error", async () => {
    expect((await request(app).post("/api/auth/login").set("Content-Type", "application/json").send('{"broken":')).status).toBe(400);
  });
  test.each([undefined, {}, { phone_number: 123, password: {} }])("invalid login body %j is rejected before querying database", async body => {
    const response = await request(app).post("/api/auth/login").send(body);
    expect(response.status).toBe(400);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
  test("empty registration body returns validation error", async () => {
    expect((await request(app).post("/api/auth/register")).status).toBe(400);
  });
  test.each([undefined, { items: [] }, { items: [null] }, { items: [{ medicineId: "medicine", quantity: 0 }] }, { items: [{ medicineId: "medicine", quantity: 1 }], promoCode: {} }])("invalid checkout %j is rejected", async body => {
    expect((await request(app).post("/api/orders").set("Authorization", auth()).send(body)).status).toBe(400);
  });
  test("catalog reports sellable stock and filters expired batches", async () => {
    (prisma.medicine.findMany as jest.Mock).mockResolvedValue([{ id: "m", name: "Medicine", price: new Prisma.Decimal(10), inventory: [{ batches: [{ quantity: 3 }] }] }]);
    const response = await request(app).get("/api/medicines");
    expect(response.status).toBe(200);
    expect(response.body.medicines[0].stock_quantity).toBe(3);
    expect(prisma.medicine.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: { inventory: { select: { batches: expect.objectContaining({ where: { expiryDate: { gt: expect.any(Date) }, quantity: { gt: 0 } } }) } } } }));
  });
  test("order details preserve rider, pharmacy, feedback, and reorder data without leaking OTP", async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(order);
    const response = await request(app).get("/api/orders/order").set("Authorization", auth());
    expect(response.status).toBe(200);
    expect(response.body.order).toMatchObject({ pharmacy: order.pharmacy, rider: order.rider, rating: 4, feedback: "Good", delivery_lat: 0, orderItems: [{ medicineId: "medicine", quantity: 2, medicine: { price: "10", requires_prescription: true } }] });
    expect(response.body.order.deliveryOtpHash).toBeUndefined();
  });
  test.each(["CUSTOMER", "RIDER", "PHARMACIST", "PHARMACY_ADMIN"])("%s cannot read an unrelated order", async role => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ ...order, status: "ACCEPTED", customerId: "other" });
    expect((await request(app).get("/api/orders/order").set("Authorization", auth(role, "other"))).status).toBe(403);
  });
  test("invalid order status is rejected", async () => {
    expect((await request(app).get("/api/orders?status=INVALID").set("Authorization", auth())).status).toBe(400);
  });
  test("order pagination stays valid for malformed parameters", async () => {
    (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.order.count as jest.Mock).mockResolvedValue(0);
    const response = await request(app).get("/api/orders?page=bad&limit=-3").set("Authorization", auth());
    expect(response.status).toBe(200);
    expect(response.body.meta).toMatchObject({ page: 1, limit: 1 });
  });
  test("pharmacy staff listing is scoped to their pharmacy", async () => {
    (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.order.count as jest.Mock).mockResolvedValue(0);
    expect((await request(app).get("/api/orders").set("Authorization", auth("PHARMACY_ADMIN", "pharmacy"))).status).toBe(200);
    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { pharmacyId: "pharmacy" } }));
  });
  test("payment cannot be made on somebody else's order", async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ ...order, customerId: "other" });
    expect((await request(app).post("/api/orders/order/payment").set("Authorization", auth()).send({})).status).toBe(403);
  });
  test("prescription approval is required before payment", async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ ...order, status: "PRESCRIPTION_PENDING" });
    expect((await request(app).post("/api/orders/order/payment").set("Authorization", auth()).send({})).status).toBe(400);
  });
  test("unassigned rider cannot verify delivery", async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ ...order, status: "OUT_FOR_DELIVERY" });
    expect((await request(app).post("/api/orders/order/delivery/verify-otp").set("Authorization", auth("RIDER")).send({ otp: "123456" })).status).toBe(403);
  });
  test.each([
    [10, 2, undefined, "49"],
    [250, 2, undefined, "500"],
    [12.99, 1, "PHARMA10", "40.69"],
  ])("checkout calculates price %s x %s with promo %s", async (price, quantity, promoCode, expected) => {
    let saved: any;
    const tx = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: "customer" }) },
      batch: {
        findMany: jest.fn().mockResolvedValue([{ id: "batch", quantity: 100, inventory: { pharmacyId: "pharmacy", medicineId: "medicine" } }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicine: { findMany: jest.fn().mockResolvedValue([{ id: "medicine", price: new Prisma.Decimal(price), requires_prescription: false }]) },
      promoCode: { findUnique: jest.fn().mockResolvedValue({ active: true, discountPercent: 10 }) },
      order: {
        create: jest.fn().mockImplementation(({ data }) => {
          saved = { ...order, ...data, orderItems: [{ id: "item", medicineId: "medicine", quantity }] };
          return saved;
        }),
        findUnique: jest.fn().mockImplementation(() => ({ ...saved, orderItems: order.orderItems })),
      },
      orderItemBatchAllocation: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inventoryTransaction: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(callback => callback(tx));
    const response = await request(app).post("/api/orders").set("Authorization", auth())
      .send({ items: [{ medicineId: "medicine", quantity }], promoCode });
    expect(response.status).toBe(201);
    expect(response.body.order.total_amount).toBe(expected);
    expect(tx.batch.updateMany).toHaveBeenCalledWith({ where: { id: "batch", quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } });
  });
  test("pharmacy staff without an assignment cannot list all inventory", async () => {
    expect((await request(app).get("/api/inventory").set("Authorization", auth("PHARMACIST"))).status).toBe(403);
    expect(prisma.inventory.findMany).not.toHaveBeenCalled();
  });
  test("scanner requires authentication and an actual image", async () => {
    expect((await request(app).post('/api/medicines/scan')).status).toBe(401);
    expect((await request(app).post('/api/medicines/scan').set('Authorization', auth())).status).toBe(400);
  });
  test("scanner returns real catalogue IDs and prices for OCR matches only", async () => {
    (OcrService.extractText as jest.Mock).mockResolvedValue('Test medicine 10 mg');
    (prisma.medicine.findMany as jest.Mock).mockResolvedValue([
      { id: 'matched', name: 'Test medicine 10 mg', price: new Prisma.Decimal(10), requires_prescription: true },
      { id: 'unmatched', name: 'Other medicine', price: new Prisma.Decimal(20) },
    ]);
    const response = await request(app).post('/api/medicines/scan').set('Authorization', auth())
      .attach('prescription', Buffer.from('image fixture'), { filename: 'rx.png', contentType: 'image/png' });
    expect(response.status).toBe(200);
    expect(response.body.medicines).toEqual([{ id: 'matched', name: 'Test medicine 10 mg', price: '10', requires_prescription: true }]);
  });
});
