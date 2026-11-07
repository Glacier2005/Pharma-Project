import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { listPharmacies, getPharmacy, getPharmacyInventory } from "../controllers/pharmacies.controller";

export const pharmaciesRouter = Router();

// Public
pharmaciesRouter.get("/", asyncHandler(listPharmacies));
pharmaciesRouter.get("/:id", asyncHandler(getPharmacy));
pharmaciesRouter.get("/:id/inventory", asyncHandler(getPharmacyInventory));
