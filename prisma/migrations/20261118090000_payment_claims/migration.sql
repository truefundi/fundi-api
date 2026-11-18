CREATE TYPE "PaymentClaimMethod" AS ENUM ('MTN', 'AIRTEL', 'CREDIT_CARD');
CREATE TYPE "PaymentClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "payment_claims" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "requestType" "JobRequestType" NOT NULL DEFAULT 'NORMAL',
    "amount" INTEGER NOT NULL,
    "paymentMethod" "PaymentClaimMethod" NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "status" "PaymentClaimStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "bookingPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_claims_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_claims_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "payment_claims_paymentNumber_check" CHECK (length(trim("paymentNumber")) > 0)
);

CREATE UNIQUE INDEX "payment_claims_bookingPaymentId_key"
ON "payment_claims"("bookingPaymentId");
CREATE INDEX "payment_claims_customerId_createdAt_idx"
ON "payment_claims"("customerId", "createdAt");
CREATE INDEX "payment_claims_status_createdAt_idx"
ON "payment_claims"("status", "createdAt");

ALTER TABLE "payment_claims"
ADD CONSTRAINT "payment_claims_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_claims"
ADD CONSTRAINT "payment_claims_serviceCategoryId_fkey"
FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_claims"
ADD CONSTRAINT "payment_claims_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_claims"
ADD CONSTRAINT "payment_claims_bookingPaymentId_fkey"
FOREIGN KEY ("bookingPaymentId") REFERENCES "booking_payments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
