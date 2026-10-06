/*
  Warnings (kept for reference; technicians were cleared beforehand):

  - This migration changes the technician_categories table shape.
  - All existing technicians were deleted so NOT NULL additions succeed.
*/

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MOMO', 'BANK_TRANSFER', 'CASH', 'OTHER');

-- Clear old category links before reshaping the table.
DELETE FROM "technician_categories";

-- DropForeignKey
ALTER TABLE "technician_categories"
  DROP CONSTRAINT "technician_categories_categoryId_fkey";

-- AlterTable: technician_categories
ALTER TABLE "technician_categories"
  DROP CONSTRAINT "technician_categories_pkey",
  ADD COLUMN "customName" TEXT,
  ADD COLUMN "customNameNormalized" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  ADD COLUMN "yearsOfExperience" INTEGER NOT NULL DEFAULT 0,
  ALTER COLUMN "categoryId" DROP NOT NULL,
  ADD CONSTRAINT "technician_categories_pkey" PRIMARY KEY ("id");

-- Remove the temporary defaults now that rows are populated.
ALTER TABLE "technician_categories"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "yearsOfExperience" DROP DEFAULT;

-- AlterTable: technician_profiles
ALTER TABLE "technician_profiles"
  DROP COLUMN "yearsOfExperience",
  ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL,
  ADD COLUMN "paymentNumber" TEXT NOT NULL,
  ALTER COLUMN "baseAddress" SET NOT NULL,
  ALTER COLUMN "baseLatitude" SET NOT NULL,
  ALTER COLUMN "baseLongitude" SET NOT NULL,
  ALTER COLUMN "gender" SET NOT NULL,
  ALTER COLUMN "nationalIdEncrypted" SET NOT NULL,
  ALTER COLUMN "nationalIdHash" SET NOT NULL;

-- CreateIndex
CREATE INDEX "technician_categories_technicianId_idx"
  ON "technician_categories"("technicianId");

-- Partial unique indexes to enforce business rules:
-- one real category per technician, one custom name per technician.
CREATE UNIQUE INDEX "technician_categories_live_real_key"
  ON "technician_categories" ("technicianId", "categoryId")
  WHERE "categoryId" IS NOT NULL;

CREATE UNIQUE INDEX "technician_categories_live_custom_key"
  ON "technician_categories" ("technicianId", "customNameNormalized")
  WHERE "categoryId" IS NULL AND "customNameNormalized" <> '';

-- AddForeignKey
ALTER TABLE "technician_categories"
  ADD CONSTRAINT "technician_categories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;



