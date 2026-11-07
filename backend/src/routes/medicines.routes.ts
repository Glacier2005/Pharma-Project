import multer from 'multer';
import { authenticate, requireRole } from '../middleware/auth.middleware';
import { Router } from "express";
import { listMedicines, scanPrescription } from "../controllers/medicines.controller";
import { asyncHandler } from "../middleware/asyncHandler";

export const medicinesRouter = Router();

medicinesRouter.get("/", asyncHandler(listMedicines));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});
medicinesRouter.post('/scan', authenticate, requireRole('CUSTOMER'), upload.single('prescription'), asyncHandler(scanPrescription));
