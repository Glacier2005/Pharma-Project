-- AlterTable: Payment - make method optional, add Razorpay fields
ALTER TABLE "Payment" ALTER COLUMN "method" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "provider" TEXT;
ALTER TABLE "Payment" ADD COLUMN "providerOrderId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "refundId" TEXT;

-- CreateIndex: unique constraint on providerOrderId prevents duplicate Razorpay order references
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex: unique constraint on refundId prevents duplicate refunds
CREATE UNIQUE INDEX "Payment_refundId_key" ON "Payment"("refundId");

-- CreateIndex: for fast lookup by providerOrderId during webhook processing
CREATE INDEX "Payment_providerOrderId_idx" ON "Payment"("providerOrderId");
