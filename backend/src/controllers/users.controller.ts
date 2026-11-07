import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";
import { AuthError } from "../middleware/auth.middleware";

const SALT_ROUNDS = 10;

const USER_SELECT = {
  id: true,
  phone_number: true,
  full_name: true,
  role: true,
  pharmacyId: true,
  createdAt: true,
} as const;

// GET /api/users/me
export async function getMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { ...USER_SELECT, _count: { select: { orders: true } } },
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ user: { ...user, orderCount: user._count.orders } });
}

// PATCH /api/users/me   body: { full_name?, password? }
export async function updateMe(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new AuthError("Unauthenticated");

  const { full_name, password } = req.body as {
    full_name?: string;
    password?: string;
  };

  const data: Record<string, string> = {};

  if (full_name !== undefined) {
    if (typeof full_name !== "string" || full_name.trim().length === 0) {
      res.status(400).json({ error: "full_name must be a non-empty string" });
      return;
    }
    data.full_name = full_name.trim();
  }

  if (password !== undefined) {
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    data.password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: USER_SELECT,
  });

  res.json({ user: updated });
}

// GET /api/users?page=&limit=   (ADMIN only)
export async function listUsers(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const skip = (page - 1) * limit;
  const role = typeof req.query.role === "string" ? req.query.role : undefined;

  if (role && !['ADMIN', 'PHARMACY_ADMIN', 'PHARMACIST', 'RIDER', 'CUSTOMER'].includes(role)) {
    res.status(400).json({ error: 'Invalid user role' });
    return;
  }
  const where = role ? { role: role as "CUSTOMER" | "RIDER" | "ADMIN" } : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      select: { ...USER_SELECT, _count: { select: { orders: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    data: users.map((u) => ({ ...u, orderCount: u._count.orders })),
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}
