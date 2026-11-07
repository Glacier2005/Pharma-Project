import { Request, Response } from "express";
import { prisma } from "../db/prisma";
import { AuthError } from "../middleware/auth.middleware";

export async function getDashboardStats(req: Request, res: Response): Promise<void> {
  if (!req.user || req.user.role !== "ADMIN") {
    throw new AuthError("Unauthorized: Admin access required");
  }

  // 1. Total Revenue (Delivered Orders)
  const revenueAggregate = await prisma.order.aggregate({
    _sum: { total_amount: true },
    where: { status: "DELIVERED" },
  });
  const totalRevenue = revenueAggregate._sum.total_amount || 0;

  // 2. Active Orders Count (PENDING, ACCEPTED, OUT_FOR_DELIVERY)
  const activeOrdersCount = await prisma.order.count({
    where: { status: { in: ["PENDING", "ACCEPTED", "OUT_FOR_DELIVERY"] } },
  });

  // 3. User Demographics
  const usersByRole = await prisma.user.groupBy({
    by: ["role"],
    _count: { _all: true },
  });
  const demographics = {
    CUSTOMER: usersByRole.find(r => r.role === "CUSTOMER")?._count._all || 0,
    RIDER: usersByRole.find(r => r.role === "RIDER")?._count._all || 0,
    ADMIN: usersByRole.find(r => r.role === "ADMIN")?._count._all || 0,
  };

  // 4. Low Stock Alerts (Stock <= 20)
  const allInventories = await prisma.inventory.findMany({
    include: {
      medicine: { select: { name: true } },
      pharmacy: { select: { name: true } },
      batches: { select: { quantity: true } }
    },
  });

  const lowStockItems = allInventories
    .map(i => {
      const stock = i.batches.reduce((sum, b) => sum + b.quantity, 0);
      return { ...i, stock };
    })
    .filter(i => i.stock <= 20)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 10);

  // 6. Average Rating
  const ratingAggregate = await prisma.order.aggregate({
    _avg: { rating: true },
    where: { rating: { not: null } }
  });
  const avgRating = ratingAggregate._avg.rating || 0;

  // 5. Recent Activity Feed (Last 10 Orders)
  const recentOrders = await prisma.order.findMany({
    take: 10,
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { full_name: true } },
      rider: { select: { full_name: true } },
    },
  });

  res.json({
    revenue: totalRevenue,
    activeOrdersCount,
    demographics,
    avgRating,
    lowStockItems: lowStockItems.map(i => ({
      id: i.id,
      medicine: i.medicine.name,
      pharmacy: i.pharmacy.name,
      stock: i.stock
    })),
    recentOrders: recentOrders.map(o => ({
      id: o.id,
      status: o.status,
      customer: o.customer.full_name,
      rider: o.rider?.full_name || null,
      amount: o.total_amount,
      createdAt: o.createdAt
    }))
  });
}
