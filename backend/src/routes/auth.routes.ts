import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { register, login } from "../controllers/auth.controller";
import { registerLimiter, loginLimiter } from "../middleware/rateLimiter";

export const authRouter = Router();

authRouter.post("/register", registerLimiter, asyncHandler(register));
authRouter.post("/login", loginLimiter, asyncHandler(login));
