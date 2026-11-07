import os

with open(r'backend\src\controllers\orders.controller.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add crypto import
if 'import crypto from "node:crypto";' not in content:
    content = content.replace(
        'import { AuthError } from "../middleware/auth.middleware";',
        'import { AuthError } from "../middleware/auth.middleware";\nimport crypto from "node:crypto";'
    )

# 2. Fix usedCount
old_usedCount = '''        if (total.lt(0)) total = new Prisma.Decimal(0);
        
        await tx.promoCode.update({
          where: { id: promo.id },
          data: { usedCount: { increment: 1 } }
        });
      }

      const needsPrescription = medicines.some(m => m.requires_prescription);'''

new_usedCount = '''        if (total.lt(0)) total = new Prisma.Decimal(0);
      }

      const needsPrescription = medicines.some(m => m.requires_prescription);'''

content = content.replace(old_usedCount, new_usedCount)

# 3. Block DELIVERED
old_statusCheck = '''  if (req.user.role === "RIDER") {
    if (["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].includes(status)) {
      if (order.riderId !== req.user.id) {
         res.status(403).json({ error: "You cannot update an order assigned to someone else." });
         return;
      }
    }
  }'''

new_statusCheck = '''  if (req.user.role === "RIDER") {
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
  }'''

content = content.replace(old_statusCheck, new_statusCheck)

# 4. Remove processPayment and Add OTP functions
if 'export async function requestDeliveryOtp' not in content:
    # We will just append the OTP functions at the end
    otp_code = '''
export async function requestDeliveryOtp(req: Request, res: Response): Promise<void> {
  if (!req.user || req.user.role !== "CUSTOMER") throw new AuthError("Unauthorized");
  const id = req.params.id as string;

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new OrderNotFoundError();

  if (order.customerId !== req.user.id) {
    throw new AuthError("Unauthorized: Not your order");
  }

  if (order.status !== "OUT_FOR_DELIVERY") {
    res.status(400).json({ error: "Order is not out for delivery." });
    return;
  }

  // Check cooldown (60 seconds)
  if (order.deliveryOtpIssuedAt && order.deliveryOtpExpiresAt && order.deliveryOtpExpiresAt > new Date()) {
    const timeSinceIssue = new Date().getTime() - order.deliveryOtpIssuedAt.getTime();
    if (timeSinceIssue < 60000) {
      res.status(429).json({ error: "OTP requested recently. Please wait before requesting again." });
      return;
    }
  }

  // Check if locked
  if (order.deliveryOtpAttempts >= 5) {
    res.status(423).json({ error: "OTP attempts exhausted. Please contact support." });
    return;
  }

  const otp = crypto.randomInt(100000, 999999).toString();
  const hash = crypto.createHash("sha256").update(otp).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  await prisma.order.update({
    where: { id },
    data: {
      deliveryOtpHash: hash,
      deliveryOtpExpiresAt: expiresAt,
      deliveryOtpIssuedAt: new Date(),
      deliveryOtpAttempts: 0,
    },
  });

  // For development, we return the plaintext OTP once
  res.json({ success: true, otp });
}

export async function verifyDeliveryOtp(req: Request, res: Response): Promise<void> {
  if (!req.user || req.user.role !== "RIDER") throw new AuthError("Unauthorized");
  const id = req.params.id as string;
  const { otp } = req.body as { otp: string };

  if (!otp || typeof otp !== "string" || otp.length !== 6) {
    res.status(400).json({ error: "Invalid OTP format." });
    return;
  }

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new OrderNotFoundError();

  if (order.riderId !== req.user.id) {
    throw new AuthError("Unauthorized: Not assigned to this order");
  }

  if (order.status !== "OUT_FOR_DELIVERY") {
    res.status(400).json({ error: "Order is not out for delivery." });
    return;
  }

  if (order.deliveryOtpAttempts >= 5) {
    res.status(423).json({ error: "OTP locked due to too many failed attempts." });
    return;
  }

  if (!order.deliveryOtpHash || !order.deliveryOtpExpiresAt) {
    res.status(400).json({ error: "OTP was not requested by the customer." });
    return;
  }

  if (order.deliveryOtpExpiresAt < new Date()) {
    res.status(400).json({ error: "OTP has expired. Customer must request a new one." });
    return;
  }

  const hash = crypto.createHash("sha256").update(otp).digest("hex");

  if (hash !== order.deliveryOtpHash) {
    // Increment attempts atomically
    const updated = await prisma.order.update({
      where: { id, status: "OUT_FOR_DELIVERY" },
      data: { deliveryOtpAttempts: { increment: 1 } },
    });
    
    if (updated.deliveryOtpAttempts >= 5) {
      res.status(423).json({ error: "OTP locked due to too many failed attempts." });
    } else {
      res.status(400).json({ error: "Invalid OTP." });
    }
    return;
  }

  // Success - Atomic update
  const updated = await prisma.order.updateMany({
    where: { 
      id, 
      status: "OUT_FOR_DELIVERY", 
      riderId: req.user.id,
      deliveryOtpAttempts: { lt: 5 } 
    },
    data: {
      status: "DELIVERED",
      deliveryOtpVerifiedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    res.status(409).json({ error: "Failed to update order status. It may have been modified concurrently." });
    return;
  }

  const finalOrder = await prisma.order.findUnique({ where: { id } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.json({ success: true, order: formatOrder(finalOrder as any) });
}
'''
    import re
    # Remove processPayment function
    content = re.sub(r'export async function processPayment.*?res\.json\(\{ success: true \}\);\n}', '', content, flags=re.DOTALL)
    
    content += '\n' + otp_code

with open(r'backend\src\controllers\orders.controller.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Python script executed successfully")
