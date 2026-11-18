CREATE TYPE "TechnicianBusinessType" AS ENUM ('INDIVIDUAL', 'COMPANY');
CREATE TYPE "ServiceChargeType" AS ENUM ('FIXED', 'PERCENTAGE');
CREATE TYPE "ServiceChargePayer" AS ENUM ('CUSTOMER', 'FUNDI');

ALTER TABLE "technician_profiles"
ADD COLUMN "businessType" "TechnicianBusinessType" NOT NULL DEFAULT 'INDIVIDUAL';

ALTER TABLE "booking_payments"
ADD COLUMN "pricingSnapshot" JSONB;

CREATE TABLE "service_charges" (
    "id" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "chargeType" "ServiceChargeType" NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "payer" "ServiceChargePayer" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "service_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "service_charges_value_check" CHECK ("value" > 0),
    CONSTRAINT "service_charges_sort_order_check" CHECK ("sortOrder" >= 0),
    CONSTRAINT "service_charges_fixed_value_check"
      CHECK ("chargeType" <> 'FIXED' OR "value" = trunc("value"))
);

CREATE INDEX "service_charges_serviceCategoryId_sortOrder_name_idx"
ON "service_charges"("serviceCategoryId", "sortOrder", "name");

ALTER TABLE "service_charges"
ADD CONSTRAINT "service_charges_serviceCategoryId_fkey"
FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "description" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_technicianId_key" ON "companies"("technicianId");
CREATE INDEX "companies_verificationStatus_createdAt_idx"
ON "companies"("verificationStatus", "createdAt");
CREATE INDEX "companies_name_idx" ON "companies"("name");

ALTER TABLE "companies"
ADD CONSTRAINT "companies_technicianId_fkey"
FOREIGN KEY ("technicianId") REFERENCES "technician_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "companies"
ADD CONSTRAINT "companies_verifiedById_fkey"
FOREIGN KEY ("verifiedById") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
