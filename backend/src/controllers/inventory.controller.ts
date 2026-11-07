import type { Request, Response } from "express";
import { prisma } from "../db/prisma";
import { Prisma } from "@prisma/client";

export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryValidationError";
  }
}

/** Narrow an Express query value to string | undefined */
function qs(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

function computeStockQuantity(batches: { quantity: number }[]): number {
  return batches.reduce((sum, b) => sum + b.quantity, 0);
}

// GET /api/inventory?pharmacyId=&page=&limit=
export async function listInventory(req: Request, res: Response): Promise<void> {
  let pharmacyId = qs(req.query.pharmacyId);
  const page  = Math.max(1, parseInt(qs(req.query.page) ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(qs(req.query.limit) ?? "20", 10) || 20));
  const skip  = (page - 1) * limit;

  // Enforce isolation for pharmacy admins/pharmacists
  if (req.user!.role !== "ADMIN") {
    if (!req.user!.pharmacyId) {
      res.status(403).json({ error: 'No pharmacy assigned' });
      return;
    }
    pharmacyId = req.user!.pharmacyId;
  }

  const where = pharmacyId ? { pharmacyId } : {};

  const [items, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      skip,
      take: limit,
      include: {
        medicine: { select: { id: true, name: true, generic_name: true, price: true } },
        pharmacy: { select: { id: true, name: true } },
        batches: { select: { id: true, quantity: true, expiryDate: true, isLegacy: true } }
      },
      orderBy: [{ pharmacy: { name: "asc" } }, { medicine: { name: "asc" } }],
    }),
    prisma.inventory.count({ where }),
  ]);

  res.json({
    data: items.map((row) => ({
      id: row.id,
      stock_quantity: computeStockQuantity(row.batches),
      pharmacy: row.pharmacy,
      medicine: {
        id: row.medicine.id,
        name: row.medicine.name,
        generic_name: row.medicine.generic_name,
        price: row.medicine.price.toString(),
      },
      batches: row.batches
    })),
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}

// GET /api/inventory/:id
export async function getInventoryItem(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);

  const row = await prisma.inventory.findUnique({
    where: { id },
    include: {
      medicine: true,
      pharmacy: { select: { id: true, name: true, latitude: true, longitude: true } },
      batches: {
        orderBy: { expiryDate: "asc" }
      }
    },
  });

  if (!row) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  if (req.user!.role !== "ADMIN" && row.pharmacyId !== req.user!.pharmacyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json({
    inventory: {
      id: row.id,
      stock_quantity: computeStockQuantity(row.batches),
      pharmacy: row.pharmacy,
      medicine: {
        id: row.medicine.id,
        name: row.medicine.name,
        generic_name: row.medicine.generic_name,
        price: row.medicine.price.toString(),
        requires_prescription: row.medicine.requires_prescription,
      },
      batches: row.batches.map(b => ({
         ...b
      }))
    },
  });
}

// POST /api/inventory/:id/batches
export async function addBatch(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const { batchNumber, quantity, manufacturingDate, expiryDate, purchasePrice, sellingPrice } = req.body;

  if (!batchNumber || !quantity || !expiryDate) {
    throw new InventoryValidationError("batchNumber, quantity, and expiryDate are required.");
  }
  
  if (quantity <= 0) {
     throw new InventoryValidationError("Quantity must be greater than 0");
  }

  const existing = await prisma.inventory.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  if (req.user!.role !== "ADMIN" && existing.pharmacyId !== req.user!.pharmacyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const batch = await prisma.$transaction(async (tx) => {
    const newBatch = await tx.batch.create({
      data: {
        inventoryId: id,
        batchNumber,
        quantity,
        manufacturingDate: manufacturingDate ? new Date(manufacturingDate) : null,
        expiryDate: new Date(expiryDate),
        purchasePrice: purchasePrice ? new Prisma.Decimal(purchasePrice) : null,
        sellingPrice: sellingPrice ? new Prisma.Decimal(sellingPrice) : null,
      }
    });

    await tx.inventoryTransaction.create({
      data: {
        batchId: newBatch.id,
        quantityDelta: quantity,
        transactionType: "PURCHASE",
        performedById: req.user!.id
      }
    });

    return newBatch;
  });

  res.status(201).json({ batch });
}

// POST /api/inventory/batches/:batchId/adjust
export async function adjustBatchStock(req: Request, res: Response): Promise<void> {
  const batchId = String(req.params.batchId);
  const { delta, transactionType } = req.body; // e.g. delta: -5, transactionType: "DAMAGED"

  if (delta === undefined || typeof delta !== "number") {
    throw new InventoryValidationError("delta must be a number");
  }

  const validTypes = ["ADJUSTMENT", "DAMAGED", "EXPIRED", "RETURN"];
  if (!validTypes.includes(transactionType)) {
     throw new InventoryValidationError(`transactionType must be one of: ${validTypes.join(", ")}`);
  }

  const batch = await prisma.batch.findUnique({
    where: { id: batchId },
    include: { inventory: true }
  });

  if (!batch) {
    res.status(404).json({ error: "Batch not found" });
    return;
  }

  if (req.user!.role !== "ADMIN" && batch.inventory.pharmacyId !== req.user!.pharmacyId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (batch.quantity + delta < 0) {
    throw new InventoryValidationError("Adjustment would result in negative stock.");
  }

  const updatedBatch = await prisma.$transaction(async (tx) => {
    const updated = await tx.batch.updateMany({
       where: { id: batchId, quantity: { gte: delta < 0 ? Math.abs(delta) : 0 } },
       data: { quantity: { increment: delta } }
    });
    
    if (updated.count === 0) {
       throw new InventoryValidationError("Concurrent modification or insufficient stock.");
    }
    
    await tx.inventoryTransaction.create({
      data: {
        batchId,
        quantityDelta: delta,
        transactionType: transactionType as any,
        performedById: req.user!.id
      }
    });

    return tx.batch.findUnique({ where: { id: batchId } });
  });

  res.json({ batch: updatedBatch });
}
