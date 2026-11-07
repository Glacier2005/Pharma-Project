import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import {
  listInventory,
  getInventoryItem,
  addBatch,
  adjustBatchStock,
} from "../controllers/inventory.controller";

export const inventoryRouter = Router();

// Allowed roles: ADMIN, PHARMACY_ADMIN, PHARMACIST
inventoryRouter.use(authenticate, requireRole("ADMIN", "PHARMACY_ADMIN", "PHARMACIST"));

inventoryRouter.get("/", asyncHandler(listInventory));
inventoryRouter.get("/:id", asyncHandler(getInventoryItem));
inventoryRouter.post("/:id/batches", asyncHandler(addBatch));
inventoryRouter.post("/batches/:batchId/adjust", asyncHandler(adjustBatchStock));
