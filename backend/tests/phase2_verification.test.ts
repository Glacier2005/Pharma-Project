import { PrismaClient } from "@prisma/client";
import { createOrder, updateOrderStatus } from "../src/controllers/orders.controller";
import type { Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.includes("?") 
    ? `${process.env.DATABASE_URL}&connection_limit=150&pool_timeout=30`
    : `${process.env.DATABASE_URL}?connection_limit=150&pool_timeout=30`;
}

const prisma = new PrismaClient();

describe("Phase 2 Final Verification", () => {
  let pharmacyId: string;
  let medicineId: string;
  let inventoryId: string;
  let customerId: string;

  beforeAll(async () => {
    const pharmacy = await prisma.pharmacy.create({
      data: { name: "Test MultiBatch Pharmacy", latitude: 0, longitude: 0 },
    });
    pharmacyId = pharmacy.id;

    const medicine = await prisma.medicine.create({
      data: {
        name: "Test MultiBatch Med",
        generic_name: "Generic Multi",
        price: 10,
        manufacturer: 'Generic',
        requires_prescription: false,
      },
    });
    medicineId = medicine.id;

    const inventory = await prisma.inventory.create({
      data: {
        pharmacyId,
        medicineId,
      },
    });
    inventoryId = inventory.id;

    const customer = await prisma.user.create({
      data: {
        full_name: "Test Customer",
        phone_number: `+9199999${Math.floor(Math.random() * 10000)}`,
        role: "CUSTOMER",
        password_hash: "mock",
      },
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await prisma.inventoryTransaction.deleteMany();
    await prisma.orderItemBatchAllocation.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.order.deleteMany();
    await prisma.batch.deleteMany();
    await prisma.inventory.deleteMany();
    await prisma.medicine.deleteMany();
    await prisma.pharmacy.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.inventoryTransaction.deleteMany();
    await prisma.orderItemBatchAllocation.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.order.deleteMany();
    await prisma.batch.deleteMany();
  });

  it("2. MULTI-BATCH CONCURRENCY: should respect FEFO and atomic limits across batches", async () => {
    const batchA = await prisma.batch.create({
      data: {
        inventoryId,
        batchNumber: "BATCH_A",
        quantity: 10,
        expiryDate: new Date(Date.now() + 1000000), // earlier
      },
    });
    
    const batchB = await prisma.batch.create({
      data: {
        inventoryId,
        batchNumber: "BATCH_B",
        quantity: 20,
        expiryDate: new Date(Date.now() + 2000000), // later
      },
    });

    const concurrentRequests = 150;
    const chunkSize = 15;
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
          createOrder(mockReq, mockRes).then(() => 201).catch(() => 400)
        );
      }
      
      const results = await Promise.all(chunkPromises);
      successes += results.filter((status) => status === 201).length;
      failures += results.filter((status) => status === 400).length;
    }

    expect(successes).toBe(30);
    expect(failures).toBe(120);

    const finalBatchA = await prisma.batch.findUnique({ where: { id: batchA.id } });
    const finalBatchB = await prisma.batch.findUnique({ where: { id: batchB.id } });
    expect(finalBatchA?.quantity).toBe(0);
    expect(finalBatchB?.quantity).toBe(0);

    const allocations = await prisma.orderItemBatchAllocation.findMany({
      include: { batch: true, orderItem: { include: { order: true } } },
      orderBy: { orderItem: { order: { createdAt: "asc" } } }
    });
    
    const batchATotal = allocations.filter(a => a.batchId === batchA.id).reduce((s, a) => s + a.quantity, 0);
    const batchBTotal = allocations.filter(a => a.batchId === batchB.id).reduce((s, a) => s + a.quantity, 0);
    
    expect(batchATotal).toBe(10);
    expect(batchBTotal).toBe(20);

    const allOrders = await prisma.order.count();
    expect(allOrders).toBe(30);
  }, 30000);

  it("5. TRANSACTION INTEGRITY: forced error rolls back everything", async () => {
    const batch = await prisma.batch.create({
      data: {
        inventoryId,
        batchNumber: "BATCH_TX",
        quantity: 100,
        expiryDate: new Date(Date.now() + 10000000000),
      },
    });

    const mockReq = {
      user: { id: customerId, role: "CUSTOMER" },
      body: { items: [{ medicineId, quantity: 10 }], forceTransactionError: true },
    } as unknown as Request;
    
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    await expect(createOrder(mockReq, mockRes)).rejects.toThrow("Simulated Database Failure");

    const updatedBatch = await prisma.batch.findUnique({ where: { id: batch.id } });
    expect(updatedBatch?.quantity).toBe(100);

    const orders = await prisma.order.count();
    expect(orders).toBe(0);

    const allocations = await prisma.orderItemBatchAllocation.count();
    expect(allocations).toBe(0);

    const transactions = await prisma.inventoryTransaction.count();
    expect(transactions).toBe(0);
  }, 30000);

  it("6. CANCELLATION IDEMPOTENCY: stock is restored exactly once", async () => {
    const batch = await prisma.batch.create({
      data: {
        inventoryId,
        batchNumber: "BATCH_CANCEL",
        quantity: 100,
        expiryDate: new Date(Date.now() + 10000000000),
      },
    });

    const mockReqCreate = {
      user: { id: customerId, role: "CUSTOMER" },
      body: { items: [{ medicineId, quantity: 10 }] },
    } as unknown as Request;
    
    const mockResCreate = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((data) => data),
    } as unknown as Response;

    await createOrder(mockReqCreate, mockResCreate);
    const orderData = (mockResCreate.json as jest.Mock).mock.calls[0][0];
    const orderId = orderData.order.id;

    let currentBatch = await prisma.batch.findUnique({ where: { id: batch.id } });
    expect(currentBatch?.quantity).toBe(90);

    const mockReqCancel = {
      user: { id: customerId, role: "CUSTOMER" },
      params: { id: orderId },
      body: { status: "CANCELLED" },
    } as unknown as Request;

    const mockResCancel = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    await updateOrderStatus(mockReqCancel, mockResCancel);
    
    currentBatch = await prisma.batch.findUnique({ where: { id: batch.id } });
    expect(currentBatch?.quantity).toBe(100);
    
    const txCount1 = await prisma.inventoryTransaction.count({ where: { transactionType: "CANCELLATION" }});
    expect(txCount1).toBe(1);

    await updateOrderStatus(mockReqCancel, mockResCancel);

    currentBatch = await prisma.batch.findUnique({ where: { id: batch.id } });
    expect(currentBatch?.quantity).toBe(100);

    const txs2 = await prisma.inventoryTransaction.findMany({ where: { batchId: batch.id } });
    expect(txs2.length).toBe(2);
  }, 30000);
});
