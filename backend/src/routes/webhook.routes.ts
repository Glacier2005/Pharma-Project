import { Router } from "express";
import { handleRazorpayWebhook } from "../controllers/payment.controller";

export const webhookRouter = Router();

// POST /api/webhooks/razorpay
// NOTE: This route MUST be registered BEFORE express.json() in index.ts
// so that req.body contains the raw Buffer for HMAC verification.
// The express.raw() middleware is applied at the route registration point in index.ts.
webhookRouter.post(
  "/razorpay",
  async (req, res) => {
    await handleRazorpayWebhook(req, res);
  }
);
