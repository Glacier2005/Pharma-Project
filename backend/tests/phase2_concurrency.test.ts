import { PrismaClient } from "@prisma/client";
import { createOrder } from "../src/controllers/orders.controller";
import type { Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.includes("?") 
    ? `${process.env.DATABASE_URL}&connection_limit=150&pool_timeout=30`
    : `${process.env.DATABASE_URL}?connection_limit=150&pool_timeout=30`;
}

const prisma = new PrismaClient();

describe("Phase 2 Concurrency Tests", () => {
  let customerId: string;
  let pharmacyId: string;
  let medicineId: string;
  let batchId: string;

  beforeAll(async () => {
    // 1. Create a customer
    const user = await prisma.user.create({
      data: {
        role: "CUSTOMER",
        phone_number: `+91999${Date.now()}`,
        full_name: "Concurrency Test Customer",
        password_hash: "mock",
      },
    });
    customerId = user.id;

    // 2. Create a pharmacy
    const pharmacy = await prisma.pharmacy.create({
      data: {
        name: `Test Pharmacy ${Date.now()}`,
        latitude: 12.9716,
        longitude: 77.5946,
      },
    });
    pharmacyId = pharmacy.id;

    // 3. Create a medicine
    const medicine = await prisma.medicine.create({
      data: {
        name: 'Concurrency Med',
        generic_name: 'ConcMed',
        manufacturer: 'Generic',
        price: 100
      },
    });
    medicineId = medicine.id;

    // 4. Create inventory link
    const inventory = await prisma.inventory.create({
      data: {
        pharmacyId,
        medicineId,
      },
    });

    // 5. Create exactly one batch with 100 units
    const batch = await prisma.batch.create({
      data: {
        inventoryId: inventory.id,
        batchNumber: `TEST-BATCH-${Date.now()}`,
        quantity: 100,
        expiryDate: new Date("2099-12-31"),
      },
    });
    batchId = batch.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should prevent negative stock when 150 concurrent checkouts request 1 unit each from a batch of 100", async () => {
    // We expect exactly 100 to succeed and 50 to fail.
    const concurrentRequests = 150;
    const chunkSize = 15; // To prevent P2024 connection pool timeout
    
    let successes = 0;
    let failures = 0;

    for (let i = 0; i < concurrentRequests; i += chunkSize) {
      const chunkPromises = [];
      for (let j = 0; j < chunkSize && i + j < concurrentRequests; j++) {
        const mockReq = {
          user: { id: customerId, role: "CUSTOMER" },
          body: { items: [{ medicineId, quantity: 1 }] },
        } as unknown as Request;

        const mockRes = {
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
        } as unknown as Response;

        chunkPromises.push(
          createOrder(mockReq, mockRes).then(() => 201).catch((err) => {
            if (!err.message.includes("Concurrent checkout depleted")) {
               console.error("Failure reason:", err.message, err.code);
            }
            return 400;
          })
        );
      }
      
      const results = await Promise.all(chunkPromises);
      successes += results.filter((status) => status === 201).length;
      failures += results.filter((status) => status === 400).length;
    }

    // Assert that the batch is exactly 0
    const finalBatch = await prisma.batch.findUnique({
      where: { id: batchId },
    });

    expect(finalBatch?.quantity).toBe(0);
    expect(successes).toBe(100);
    expect(failures).toBe(50);
  }, 120000); // Increase timeout to 120s
});
