-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryOtpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "deliveryOtpHash" TEXT,
ADD COLUMN     "deliveryOtpIssuedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryOtpVerifiedAt" TIMESTAMP(3);
