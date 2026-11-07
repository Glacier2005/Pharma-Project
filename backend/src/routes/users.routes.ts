import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth.middleware";
import { getMe, updateMe, listUsers } from "../controllers/users.controller";

export const usersRouter = Router();

// All user routes require authentication
usersRouter.use(authenticate);

usersRouter.get("/me", asyncHandler(getMe));
usersRouter.patch("/me", asyncHandler(updateMe));

// Admin-only: list all users
usersRouter.get("/", requireRole("ADMIN"), asyncHandler(listUsers));
