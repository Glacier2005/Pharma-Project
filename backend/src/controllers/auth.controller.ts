import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";
import { signToken } from "../lib/jwt";

const SALT_ROUNDS = 10;

export class AuthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthValidationError";
  }
}

// POST /api/auth/register
export async function register(req: Request, res: Response): Promise<void> {
  const { phone_number, full_name, password } = (req.body ?? {}) as {
    phone_number?: string;
    full_name?: string;
    password?: string;
    role?: string;
  };

  if (typeof phone_number !== "string" || !phone_number.trim()) {
    throw new AuthValidationError("phone_number is required");
  }
  if (typeof full_name !== "string" || !full_name.trim()) {
    throw new AuthValidationError("full_name is required");
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    throw new AuthValidationError("password must be at least 8 characters");
  }

  const existing = await prisma.user.findUnique({ where: { phone_number } });
  if (existing) {
    throw new AuthValidationError("A user with that phone number already exists");
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      phone_number,
      full_name,
      password_hash,
      role: "CUSTOMER",
    },
    select: { id: true, phone_number: true, full_name: true, role: true, createdAt: true },
  });

  const token = signToken({ sub: user.id, role: user.role, pharmacyId: (user as any).pharmacyId ?? undefined });

  res.status(201).json({ user, token });
}

// POST /api/auth/login
export async function login(req: Request, res: Response): Promise<void> {
  const { phone_number, password } = (req.body ?? {}) as {
    phone_number?: string;
    password?: string;
  };

  if (typeof phone_number !== "string" || !phone_number.trim() || typeof password !== "string" || !password) {
    throw new AuthValidationError("phone_number and password are required");
  }

  const user = await prisma.user.findUnique({ where: { phone_number } });
  if (!user) {
    throw new AuthValidationError("Invalid credentials");
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AuthValidationError("Invalid credentials");
  }

  const token = signToken({ sub: user.id, role: user.role, pharmacyId: user.pharmacyId ?? undefined });

  res.json({
    user: {
      id: user.id,
      phone_number: user.phone_number,
      full_name: user.full_name,
      role: user.role,
      pharmacyId: user.pharmacyId,
      createdAt: user.createdAt,
    },
    token,
  });
}
