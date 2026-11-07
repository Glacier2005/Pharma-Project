import request from "supertest";
import { app } from "../src/index";
import { prisma } from "../src/db/prisma";
import { signToken } from "../src/lib/jwt";
import crypto from "node:crypto";
import { Server } from "http";

let server: Server;

beforeAll(async () => {
  server = app.listen(0);
  await prisma.orderItemBatchAllocation.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.pharmacy.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.orderItemBatchAllocation.deleteMany();
  await prisma.inventoryTransaction.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inventory.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.pharmacy.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
  server.close();
});

describe("Phase 4D — Delivery OTP Security", () => {
  let customerToken: string;
  let riderToken: string;
  let riderId: string;
  let customerId: string;
  let orderId: string;

  beforeAll(async () => {
    // 1. Create Customer
    const customer = await prisma.user.create({
      data: {
        phone_number: "+91901" + Date.now().toString().slice(-7),
        password_hash: "hash",
        full_name: "OTP Customer",
        role: "CUSTOMER",
      },
    });
    customerId = customer.id;
    customerToken = signToken({ sub: customer.id, role: "CUSTOMER" });

    // 2. Create Rider
    const rider = await prisma.user.create({
      data: {
        phone_number: "+91902" + Date.now().toString().slice(-7),
        password_hash: "hash",
        full_name: "OTP Rider",
        role: "RIDER",
      },
    });
    riderId = rider.id;
    riderToken = signToken({ sub: rider.id, role: "RIDER" });

    // 3. Create Pharmacy
    const pharmacy = await prisma.pharmacy.create({
      data: {
        name: "OTP Pharmacy",
        latitude: 0,
        longitude: 0,
      },
    });

    // 4. Create Order
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        pharmacyId: pharmacy.id,
        riderId: rider.id,
        status: "OUT_FOR_DELIVERY",
        total_amount: 500,
      },
    });
    orderId = order.id;
  });

  it("prevents transitioning to DELIVERED without OTP via standard status endpoint", async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set("Authorization", `Bearer ${riderToken}`)
      .send({ status: "DELIVERED" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Use OTP verification/);
  });

  it("allows customer to request OTP and receive plaintext", async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/delivery/request-otp`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.otp).toBe("string");
    expect(res.body.otp).toHaveLength(6);
  });

  it("prevents brute forcing by locking out after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`/api/orders/${orderId}/delivery/verify-otp`)
        .set("Authorization", `Bearer ${riderToken}`)
        .send({ otp: "000000" });

      if (i < 4) {
        expect(res.status).toBe(400); // Invalid OTP
      } else {
        expect(res.status).toBe(423); // Locked
      }
    }

    // A valid request should now be rejected as locked
    const res2 = await request(app)
      .post(`/api/orders/${orderId}/delivery/verify-otp`)
      .set("Authorization", `Bearer ${riderToken}`)
      .send({ otp: "000000" });
      
    expect(res2.status).toBe(423);
  });

  it("successfully verifies OTP and marks DELIVERED with valid OTP", async () => {
    // Reset order state for fresh OTP
    await prisma.order.update({
      where: { id: orderId },
      data: { deliveryOtpAttempts: 0, status: "OUT_FOR_DELIVERY", deliveryOtpIssuedAt: null }
    });

    const reqRes = await request(app)
      .post(`/api/orders/${orderId}/delivery/request-otp`)
      .set("Authorization", `Bearer ${customerToken}`);
    const validOtp = reqRes.body.otp;

    const res = await request(app)
      .post(`/api/orders/${orderId}/delivery/verify-otp`)
      .set("Authorization", `Bearer ${riderToken}`)
      .send({ otp: validOtp });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.order.status).toBe("DELIVERED");

    // Verify DB
    const finalOrder = await prisma.order.findUnique({ where: { id: orderId } });
    expect(finalOrder?.status).toBe("DELIVERED");
    expect(finalOrder?.deliveryOtpVerifiedAt).not.toBeNull();
  });
});
