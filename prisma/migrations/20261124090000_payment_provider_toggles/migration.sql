CREATE TYPE "MobilePaymentProvider" AS ENUM ('MTN', 'AIRTEL');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

CREATE TABLE "payment_provider_settings" (
    "provider" "MobilePaymentProvider" NOT NULL,
    "apiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_provider_settings_pkey" PRIMARY KEY ("provider")
);

-- Existing installations retain manual approval until an admin enables a provider.
INSERT INTO "payment_provider_settings" ("provider", "apiEnabled", "updatedAt")
VALUES ('MTN', false, CURRENT_TIMESTAMP), ('AIRTEL', false, CURRENT_TIMESTAMP);

CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "provider" "MobilePaymentProvider" NOT NULL,
    "requestType" "JobRequestType" NOT NULL DEFAULT 'NORMAL',
    "phoneNumber" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "pricingSnapshot" JSONB NOT NULL,
    "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "externalPaymentId" TEXT NOT NULL,
    "bookingPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_transactions_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "payment_transactions_customerId_idempotencyKey_key"
ON "payment_transactions"("customerId", "idempotencyKey");
CREATE UNIQUE INDEX "payment_transactions_externalPaymentId_key"
ON "payment_transactions"("externalPaymentId");
CREATE UNIQUE INDEX "payment_transactions_bookingPaymentId_key"
ON "payment_transactions"("bookingPaymentId");
CREATE INDEX "payment_transactions_customerId_createdAt_idx"
ON "payment_transactions"("customerId", "createdAt");
CREATE INDEX "payment_transactions_provider_status_createdAt_idx"
ON "payment_transactions"("provider", "status", "createdAt");

ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_serviceCategoryId_fkey"
FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_bookingPaymentId_fkey"
FOREIGN KEY ("bookingPaymentId") REFERENCES "booking_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
