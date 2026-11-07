import { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { AuthError } from '../middleware/auth.middleware';
import { StorageService } from '../services/StorageService';
import { OcrService } from '../services/OcrService';
import { AiService } from '../services/AiService';
import { Prisma } from '@prisma/client';

export async function uploadPrescription(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError('Unauthenticated');
  const orderId = String(req.params.orderId);

  if (!req.file || req.file.buffer.length === 0) {
    res.status(400).json({ error: 'No file uploaded or file is empty' });
    return;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  if (order.customerId !== req.user.id) {
    res.status(403).json({ error: 'Forbidden: not your order' });
    return;
  }

  // Upload to storage
  const storage = StorageService.getProvider();
  const storageKey = await storage.uploadFile(req.file.buffer, req.file.originalname);

  // Run OCR
  let ocrText = '';
  if (req.file.mimetype.startsWith('image/')) {
    try { ocrText = await OcrService.extractText(req.file.buffer); }
    catch { /* OCR is advisory; keep the upload for pharmacist review. */ }
  }
  
  // Try AI parsing (advisory only)
  const aiSuggestions = await AiService.structurePrescriptionText(ocrText);

  const prescription = await prisma.prescription.create({
    data: {
      orderId,
      customerId: req.user.id,
      storageKey,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      status: 'PENDING',
      ocrText,
      aiSuggestions: aiSuggestions as Prisma.InputJsonValue,
    }
  });

  res.status(201).json({ success: true, prescription });
}

export async function getPendingPrescriptions(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError('Unauthenticated');
  if (req.user.role !== 'PHARMACIST' && req.user.role !== 'ADMIN' && req.user.role !== 'PHARMACY_ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  let pharmacyFilter = {};
  if (req.user.role === 'PHARMACIST' || req.user.role === 'PHARMACY_ADMIN') {
    if (!req.user.pharmacyId) {
       res.status(403).json({ error: 'You are not assigned to a pharmacy' });
       return;
    }
    pharmacyFilter = { order: { pharmacyId: req.user.pharmacyId } };
  }

  const prescriptions = await prisma.prescription.findMany({
    where: { 
      status: 'PENDING',
      ...pharmacyFilter 
    },
    include: {
      order: {
        include: {
          orderItems: {
            include: { medicine: true }
          }
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });

  res.json({ prescriptions });
}

export async function claimPrescription(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError('Unauthenticated');
  if (req.user.role !== 'PHARMACIST' && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const id = String(req.params.id);

  // Verify access
  const rx = await prisma.prescription.findUnique({ where: { id }, include: { order: true } });

  if (!rx) {
    res.status(404).json({ error: 'Prescription not found' });
    return;
  }

  if (['PHARMACIST', 'PHARMACY_ADMIN'].includes(req.user.role) && rx.order?.pharmacyId !== req.user.pharmacyId) {
    res.status(403).json({ error: 'Forbidden: Prescription belongs to a different pharmacy' });
    return;
  }

  // Atomic claim
  const updated = await prisma.prescription.updateMany({
    where: { id, pharmacistId: null },
    data: { pharmacistId: req.user.id }
  });

  if (updated.count === 0) {
    // Determine if it was already claimed or missing
    res.status(409).json({ error: 'Prescription already claimed by another pharmacist' });
    return;
  }

  res.json({ success: true });
}

export async function verifyPrescription(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError('Unauthenticated');
  if (req.user.role !== 'PHARMACIST' && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const id = String(req.params.id);
  const { status, notes } = req.body as { status: 'APPROVED' | 'REJECTED'; notes?: string };

  if (status !== 'APPROVED' && status !== 'REJECTED') {
    res.status(400).json({ error: 'Invalid status. Must be APPROVED or REJECTED' });
    return;
  }

  if (status === 'REJECTED' && (!notes || notes.trim() === '')) {
    res.status(400).json({ error: 'Rejection reason is required in notes' });
    return;
  }

  const rx = await prisma.prescription.findUnique({ where: { id }, include: { order: true } });

  if (!rx) {
    res.status(404).json({ error: 'Prescription not found' });
    return;
  }

  if (['PHARMACIST', 'PHARMACY_ADMIN'].includes(req.user.role) && rx.order?.pharmacyId !== req.user.pharmacyId) {
    res.status(403).json({ error: 'Forbidden: Prescription belongs to a different pharmacy' });
    return;
  }

  if (rx.status !== 'PENDING') {
    res.status(400).json({ error: 'Prescription is already verified' });
    return;
  }
  
  if (rx.pharmacistId !== req.user.id && req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden: You must claim the prescription first' });
    return;
  }

  const updatedRx = await prisma.$transaction(async (tx) => {
    const p = await tx.prescription.update({
      where: { id },
      data: { status, notes }
    });

    if (status === 'APPROVED') {
       // Transition order to PAYMENT_PENDING
       await tx.order.update({
         where: { id: rx.orderId, status: 'PRESCRIPTION_PENDING' },
         data: { status: 'PAYMENT_PENDING' }
       });
    } else if (status === 'REJECTED') {
       // Rejection cancels order - idempotency handled by the phase 2 logic
       // But we need to actually execute the cancellation logic here
       const currentOrder = await tx.order.findUnique({
          where: { id: rx.orderId },
          include: { orderItems: { include: { allocations: true } } }
       });
       if (currentOrder && currentOrder.status !== 'CANCELLED') {
          await tx.order.update({
             where: { id: rx.orderId },
             data: { status: 'CANCELLED' }
          });
          
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
                 transactionType: 'CANCELLATION',
                 referenceId: rx.orderId,
                 performedById: req.user!.id
               });
            }
          }
          if (transactionsToCreate.length > 0) {
             await tx.inventoryTransaction.createMany({ data: transactionsToCreate as any });
          }
       }
    }
    return p;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  res.json({ success: true, prescription: updatedRx });
}

export async function getPrescriptionImage(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError('Unauthenticated');

  const id = String(req.params.id);

  const rx = await prisma.prescription.findUnique({ where: { id }, include: { order: true } });

  if (!rx) {
    res.status(404).json({ error: 'Prescription not found' });
    return;
  }

  // BOLA checks
  if (req.user.role === 'CUSTOMER') {
    if (rx.customerId !== req.user.id) {
       res.status(403).json({ error: 'Forbidden: not your prescription' });
       return;
    }
  } else if (req.user.role === 'PHARMACIST' || req.user.role === 'PHARMACY_ADMIN') {
    if (rx.order?.pharmacyId !== req.user.pharmacyId) {
       res.status(403).json({ error: 'Forbidden: different pharmacy' });
       return;
    }
  } else if (req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const storage = StorageService.getProvider();
  
  try {
    if (typeof (storage as any).getSignedUrl === 'function') {
      const url = await (storage as any).getSignedUrl(rx.storageKey);
      res.json({ url });
    } else {
      const stream = await storage.getFileStream(rx.storageKey);
      res.setHeader('Content-Type', rx.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${rx.originalFilename}"`);
      stream.pipe(res);
    }
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'Image file not found on server' });
    } else {
      res.status(500).json({ error: 'Failed to read image' });
    }
  }
}
