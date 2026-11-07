import { Router } from 'express';
import { authenticate, requireRole } from "../middleware/auth.middleware";
import multer from 'multer';
import {
  uploadPrescription,
  getPendingPrescriptions,
  claimPrescription,
  verifyPrescription,
  getPrescriptionImage
} from '../controllers/prescriptions.controller';

const router = Router();

// Configure multer (in-memory, file type validation)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and PDF are allowed.'));
    }
  }
});

// Middleware to handle multer errors
const uploadMiddleware = (req: any, res: any, next: any) => {
  upload.single('prescription')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
};

router.post(
  '/orders/:orderId/prescriptions',
  authenticate,
  requireRole('CUSTOMER'),
  uploadMiddleware,
  uploadPrescription
);

// Pharmacist endpoints
router.get('/prescriptions/pending', authenticate, requireRole('PHARMACIST', 'PHARMACY_ADMIN', 'ADMIN'), getPendingPrescriptions);
router.patch('/prescriptions/:id/claim', authenticate, requireRole('PHARMACIST', 'PHARMACY_ADMIN', 'ADMIN'), claimPrescription);
router.patch('/prescriptions/:id/verify', authenticate, requireRole('PHARMACIST', 'PHARMACY_ADMIN', 'ADMIN'), verifyPrescription);

// Secure image retrieval (BOLA protected inside controller)
router.get('/prescriptions/:id/image', authenticate, getPrescriptionImage);

export default router;
