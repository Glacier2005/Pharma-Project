const fs = require('fs');
let content = fs.readFileSync('backend/src/controllers/orders.controller.ts', 'utf8');

const corrupted = `    const updated = await prisma.order.findUnique({
      where: { id },
      include: { orderItems: { select: ORDER_ITEM_SELECT } },
        where: { id },
        include: { orderItems: { include: { allocations: true } } }
      });`;

const correct = `    const updated = await prisma.order.findUnique({
      where: { id },
      include: { orderItems: { select: ORDER_ITEM_SELECT } },
    });
    res.json({ order: formatOrder(updated!) });
    return;
  }

  if (req.user.role === "RIDER") {
    if (["OUT_FOR_DELIVERY", "CANCELLED"].includes(status)) {
      if (order.riderId !== req.user.id) {
         res.status(403).json({ error: "You cannot update an order assigned to someone else." });
         return;
      }
    }
  }

  if (status === "DELIVERED") {
    res.status(403).json({ error: "Cannot transition to DELIVERED directly. Use OTP verification." });
    return;
  }

  if (status === "CANCELLED") {
    const updatedOrder = await prisma.$transaction(async (tx) => {
      const currentOrder = await tx.order.findUnique({
        where: { id },
        include: { orderItems: { include: { allocations: true } } }
      });`;

if (content.includes(corrupted)) {
  content = content.replace(corrupted, correct);
  fs.writeFileSync('backend/src/controllers/orders.controller.ts', content, 'utf8');
  console.log('Fixed file');
} else {
  console.log('Could not find corrupted string');
}
