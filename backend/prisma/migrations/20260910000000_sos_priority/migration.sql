ALTER TABLE "Order" ADD COLUMN "is_emergency" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Order_status_is_emergency_createdAt_idx" ON "Order"("status", "is_emergency", "createdAt");
