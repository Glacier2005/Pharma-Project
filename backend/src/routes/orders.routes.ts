import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  createOrder,
  listOrders,
  getOrder,
  updateOrderStatus,
  submitOrderFeedback,
  requestDeliveryOtp,
  verifyDeliveryOtp,
} from "../controllers/orders.controller";
import { otpRequestLimiter, otpVerifyLimiter } from "../middleware/rateLimiter";

export const ordersRouter = Router();

// All order routes require authentication
ordersRouter.use(authenticate);

ordersRouter.post("/", requireRole("CUSTOMER"), asyncHandler(createOrder));
ordersRouter.get("/", asyncHandler(listOrders));
ordersRouter.get("/:id", asyncHandler(getOrder));
ordersRouter.patch("/:id/status", requireRole("CUSTOMER", "RIDER", "ADMIN"), asyncHandler(updateOrderStatus));
ordersRouter.patch("/:id/feedback", requireRole("CUSTOMER"), asyncHandler(submitOrderFeedback));
ordersRouter.post("/:id/delivery/request-otp", requireRole("CUSTOMER"), otpRequestLimiter, asyncHandler(requestDeliveryOtp));
ordersRouter.post("/:id/delivery/verify-otp", requireRole("RIDER"), otpVerifyLimiter, asyncHandler(verifyDeliveryOtp));
