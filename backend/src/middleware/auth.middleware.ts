import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// Augment Express Request with user identity
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        pharmacyId?: string;
      };
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AuthError("Missing or malformed Authorization header"));
  }
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role, pharmacyId: payload.pharmacyId };
    next();
  } catch {
    next(new AuthError("Invalid or expired token"));
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthError("Unauthenticated"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AuthError("Insufficient permissions", 403));
    }
    next();
  };
}
