import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import { getDashboardStats } from "../controllers/admin.controller";
import { asyncHandler } from "../middleware/asyncHandler";

const router = Router();

router.get("/analytics", authenticate, requireRole("ADMIN"), asyncHandler(getDashboardStats));

export { router as adminRouter };
