const fs = require('fs');
let content = fs.readFileSync('backend/src/controllers/orders.controller.ts', 'utf8');

// 1. Add crypto import
if (!content.includes('import crypto')) {
  content = content.replace('import { AuthError } from "../middleware/auth.middleware";', 
  'import { AuthError } from "../middleware/auth.middleware";\nimport crypto from "node:crypto";');
}

// 2. Remove usedCount update
const oldUsedCount = `        if (total.lt(0)) total = new Prisma.Decimal(0);
        
        await tx.promoCode.update({
          where: { id: promo.id },
          data: { usedCount: { increment: 1 } }
        });
      }

      const needsPrescription = medicines.some(m => m.requires_prescription);`;

const newUsedCount = `        if (total.lt(0)) total = new Prisma.Decimal(0);
      }

      const needsPrescription = medicines.some(m => m.requires_prescription);`;

content = content.replace(oldUsedCount, newUsedCount);

// 3. Update updateOrderStatus block
const oldStatusCheck = `  if (req.user.role === "RIDER") {
    if (["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].includes(status)) {
      if (order.riderId !== req.user.id) {
         res.status(403).json({ error: "You cannot update an order assigned to someone else." });
         return;
      }
    }
  }`;

const newStatusCheck = `  if (req.user.role === "RIDER" && ["OUT_FOR_DELIVERY", "CANCELLED"].includes(status)) {
    if (order.riderId !== req.user.id) {
       res.status(403).json({ error: "You cannot update an order assigned to someone else." });
       return;
    }
  }

  if (status === "DELIVERED") {
    res.status(403).json({ error: "Cannot transition to DELIVERED directly. Use OTP verification." });
    return;
  }`;

content = content.replace(oldStatusCheck, newStatusCheck);

fs.writeFileSync('backend/src/controllers/orders.controller.ts', content, 'utf8');
console.log('Fixed orders.controller.ts completely');
