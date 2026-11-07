import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

/** Narrow an Express query value to string | undefined */
function qs(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

// GET /api/pharmacies
export async function listPharmacies(_req: Request, res: Response): Promise<void> {
  const pharmacies = await prisma.pharmacy.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { inventory: true } },
    },
  });

  res.json({
    pharmacies: pharmacies.map((p) => ({
      id: p.id,
      name: p.name,
      latitude: p.latitude,
      longitude: p.longitude,
      inventoryCount: p._count.inventory,
    })),
  });
}

// GET /api/pharmacies/:id
export async function getPharmacy(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);

  const pharmacy = await prisma.pharmacy.findUnique({
    where: { id },
    include: {
      _count: { select: { inventory: true, orders: true } },
    },
  });

  if (!pharmacy) {
    res.status(404).json({ error: "Pharmacy not found" });
    return;
  }

  res.json({
    pharmacy: {
      id: pharmacy.id,
      name: pharmacy.name,
      latitude: pharmacy.latitude,
      longitude: pharmacy.longitude,
      inventoryCount: pharmacy._count.inventory,
      orderCount: pharmacy._count.orders,
    },
  });
}

// GET /api/pharmacies/:id/inventory?q=&page=&limit=
export async function getPharmacyInventory(req: Request, res: Response): Promise<void> {
  const id    = String(req.params.id);
  const q     = qs(req.query.q)?.trim();
  const page  = Math.max(1,   parseInt(qs(req.query.page)  ?? "1",  10));
  const limit = Math.min(100, parseInt(qs(req.query.limit) ?? "20", 10));
  const skip  = (page - 1) * limit;

  const where: Prisma.InventoryWhereInput = {
    pharmacyId: id,
    ...(q
      ? {
          medicine: {
            OR: [
              { name:         { contains: q, mode: "insensitive" } },
              { generic_name: { contains: q, mode: "insensitive" } },
            ],
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      skip,
      take: limit,
      include: {
        medicine: {
          select: {
            id: true,
            name: true,
            generic_name: true,
            price: true,
            requires_prescription: true,
          },
        },
        batches: { select: { quantity: true } }
      },
      orderBy: { medicine: { name: "asc" } },
    }),
    prisma.inventory.count({ where }),
  ]);

  res.json({
    data: items.map((row) => {
      const stock = row.batches.reduce((sum, b) => sum + b.quantity, 0);
      return {
        inventoryId: row.id,
        stock_quantity: stock,
        medicine: {
          id: row.medicine.id,
          name: row.medicine.name,
          generic_name: row.medicine.generic_name,
          price: row.medicine.price.toString(),
          requires_prescription: row.medicine.requires_prescription,
        },
      };
    }),
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}
