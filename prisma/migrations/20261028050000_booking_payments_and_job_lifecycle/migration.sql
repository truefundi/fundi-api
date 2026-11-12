ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

CREATE TYPE "BookingPaymentStatus" AS ENUM (
  'VALID',
  'EXPIRED',
  'PAUSED',
  'RESUMED',
  'COMPLETED'
);

CREATE TYPE "CancellationRequester" AS ENUM ('CUSTOMER', 'TECHNICIAN');
CREATE TYPE "CancellationRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "users"
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

ALTER TABLE "service_categories"
  ADD COLUMN "bookingFee" INTEGER;

ALTER TABLE "technician_profiles"
  ADD COLUMN "nationalIdEncrypted" TEXT,
  ADD COLUMN "nationalIdHash" TEXT,
  ADD COLUMN "nationalIdLast4" TEXT,
  ADD COLUMN "rejectionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancellationCount" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "technician_profiles_nationalIdHash_key"
  ON "technician_profiles"("nationalIdHash");

CREATE TABLE "customer_phone_verifications" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_phone_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_phone_verifications_customerId_createdAt_idx"
  ON "customer_phone_verifications"("customerId", "createdAt");

ALTER TABLE "customer_phone_verifications"
  ADD CONSTRAINT "customer_phone_verifications_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "jobs"
  ADD COLUMN "customerHiddenAt" TIMESTAMP(3),
  ADD COLUMN "technicianHiddenAt" TIMESTAMP(3),
  ADD COLUMN "customerPauseRequestedAt" TIMESTAMP(3),
  ADD COLUMN "technicianPauseRequestedAt" TIMESTAMP(3),
  ADD COLUMN "customerResumeRequestedAt" TIMESTAMP(3),
  ADD COLUMN "technicianResumeRequestedAt" TIMESTAMP(3),
  ADD COLUMN "phoneVerificationId" TEXT;

CREATE UNIQUE INDEX "jobs_phoneVerificationId_key"
  ON "jobs"("phoneVerificationId");
CREATE INDEX "jobs_customerId_customerHiddenAt_createdAt_idx"
  ON "jobs"("customerId", "customerHiddenAt", "createdAt");
CREATE INDEX "jobs_technicianId_technicianHiddenAt_updatedAt_idx"
  ON "jobs"("technicianId", "technicianHiddenAt", "updatedAt");

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_phoneVerificationId_fkey"
  FOREIGN KEY ("phoneVerificationId") REFERENCES "customer_phone_verifications"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "booking_payments" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "serviceCategoryId" TEXT NOT NULL,
  "jobId" TEXT,
  "externalPaymentId" TEXT NOT NULL,
  "paymentKeyId" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "status" "BookingPaymentStatus" NOT NULL DEFAULT 'VALID',
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "remainingValiditySeconds" INTEGER,
  "extensionCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_payments_jobId_key" ON "booking_payments"("jobId");
CREATE UNIQUE INDEX "booking_payments_externalPaymentId_key"
  ON "booking_payments"("externalPaymentId");
CREATE INDEX "booking_payments_customerId_paidAt_idx"
  ON "booking_payments"("customerId", "paidAt");
CREATE INDEX "booking_payments_status_validUntil_idx"
  ON "booking_payments"("status", "validUntil");

ALTER TABLE "booking_payments"
  ADD CONSTRAINT "booking_payments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_payments_serviceCategoryId_fkey"
  FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "booking_payments_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "job_cancellation_requests" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requester" "CancellationRequester" NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "CancellationRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_cancellation_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_cancellation_requests_jobId_status_idx"
  ON "job_cancellation_requests"("jobId", "status");
CREATE INDEX "job_cancellation_requests_status_createdAt_idx"
  ON "job_cancellation_requests"("status", "createdAt");

ALTER TABLE "job_cancellation_requests"
  ADD CONSTRAINT "job_cancellation_requests_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
