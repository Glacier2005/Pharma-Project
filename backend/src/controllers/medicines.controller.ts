import { OcrService } from '../services/OcrService';
import type { Request, Response } from "express";
import { prisma } from "../db/prisma";

export async function listMedicines(_req: Request, res: Response): Promise<void> {
  const medicines = await prisma.medicine.findMany({
    orderBy: { name: "asc" },
    include: {
      inventory: {
        select: { batches: { where: { expiryDate: { gt: new Date() }, quantity: { gt: 0 } }, select: { quantity: true } } },
      },
    },
  });

  res.json({
    medicines: medicines.map((m) => {
      const totalStock = m.inventory.reduce((sum, inv) => 
        sum + inv.batches.reduce((bSum, b) => bSum + b.quantity, 0), 0);
      
      return {
        id: m.id,
        name: m.name,
        generic_name: m.generic_name,
        price: m.price.toString(),
        requires_prescription: m.requires_prescription,
        stock_quantity: totalStock,
      };
    }),
  });
}

// OCR results are suggestions; prescription approval remains mandatory.
export async function scanPrescription(req: Request, res: Response): Promise<void> {
  if (!req.file?.buffer.length) {
    res.status(400).json({ error: 'A prescription image is required' });
    return;
  }
  const text = (await OcrService.extractText(req.file.buffer)).toLowerCase();
  const medicines = await prisma.medicine.findMany({ orderBy: { name: 'asc' } });
  // Use complete catalogue names to avoid guessing strengths or substituting drugs.
  const matches = medicines.filter(m => text.includes(m.name.toLowerCase()));
  res.json({ medicines: matches.map(m => ({
    id: m.id, name: m.name, generic_name: m.generic_name,
    price: m.price.toString(), requires_prescription: m.requires_prescription,
  })) });
}
