-- Each service a technician offers is reviewed on its own.
ALTER TABLE "technician_categories"
  ADD COLUMN "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Services of technicians who are already approved keep working.
UPDATE "technician_categories" tc
SET "status" = 'APPROVED', "reviewedAt" = tp."updatedAt"
FROM "technician_profiles" tp
WHERE tp."id" = tc."technicianId" AND tp."verificationStatus" = 'APPROVED';

CREATE INDEX "technician_categories_status_createdAt_idx"
  ON "technician_categories"("status", "createdAt");
