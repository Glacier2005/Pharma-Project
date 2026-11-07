import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import { createPayment } from "../controllers/payment.controller";
import { paymentLimiter } from "../middleware/rateLimiter";

export const paymentRouter = Router();

// POST /api/orders/:id/payment — customer-only, rate-limited
paymentRouter.post(
  "/orders/:id/payment",
  authenticate,
  requireRole("CUSTOMER"),
  paymentLimiter,
  asyncHandler(createPayment)
);
