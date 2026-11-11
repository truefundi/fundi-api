-- Split DocumentType into NATIONAL_ID and CERTIFICATE, and move
-- TVET_CERTIFICATE to a new CertificateType enum. Add certificate linking
-- to a service category (real or custom name).
--
-- The DocumentType column is swapped using the "new column + copy + drop +
-- rename" pattern. Doing an ALTER COLUMN TYPE ... USING (CASE ...) directly
-- causes a parse-time enum comparison failure in Postgres, so we sidestep it.

-- 1. New CertificateType enum.
CREATE TYPE "CertificateType" AS ENUM (
  'TVET_CERTIFICATE',
  'DIPLOMA',
  'ADVANCED_DIPLOMA',
  'DEGREE',
  'SHORT_COURSE',
  'OTHER'
);

-- 2. Add the certificate columns. Nullable so existing rows remain valid.
ALTER TABLE "technician_documents"
  ADD COLUMN "certificateType" "CertificateType",
  ADD COLUMN "categoryId" TEXT,
  ADD COLUMN "customCategoryName" TEXT,
  ADD COLUMN "customCategoryNormalized" TEXT;

-- 3. Backfill certificateType on existing rows that used the old
--    TVET_CERTIFICATE document type.
UPDATE "technician_documents"
SET "certificateType" = 'TVET_CERTIFICATE'
WHERE "type"::text = 'TVET_CERTIFICATE';

-- 4. Swap DocumentType via a new column to avoid the parse-time enum
--    comparison that Postgres would otherwise raise.

-- 4a. New enum under a temporary name.
CREATE TYPE "DocumentType_v2" AS ENUM ('NATIONAL_ID', 'CERTIFICATE');

-- 4b. New column of the new type.
ALTER TABLE "technician_documents"
  ADD COLUMN "type_v2" "DocumentType_v2";

-- 4c. Copy values, folding TVET_CERTIFICATE into CERTIFICATE.
UPDATE "technician_documents"
SET "type_v2" = CASE
  WHEN "type"::text = 'TVET_CERTIFICATE' THEN 'CERTIFICATE'::"DocumentType_v2"
  ELSE "type"::text::"DocumentType_v2"
END;

-- 4d. Drop the old column (indexes referencing it are dropped too).
ALTER TABLE "technician_documents" DROP COLUMN "type";

-- 4e. Rename the new column.
ALTER TABLE "technician_documents" RENAME COLUMN "type_v2" TO "type";

-- 4f. Enforce NOT NULL.
ALTER TABLE "technician_documents" ALTER COLUMN "type" SET NOT NULL;

-- 4g. Drop the old enum and give the new one the final name.
DROP TYPE "DocumentType";
ALTER TYPE "DocumentType_v2" RENAME TO "DocumentType";

-- 5. Foreign key and index for categoryId.
ALTER TABLE "technician_documents"
  ADD CONSTRAINT "technician_documents_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "technician_documents_categoryId_idx"
  ON "technician_documents"("categoryId");

-- 6. Recreate the indexes that step 4d dropped because they referenced "type".
CREATE INDEX "technician_documents_type_idx"
  ON "technician_documents"("type");

CREATE UNIQUE INDEX "technician_documents_live_national_id_key"
  ON "technician_documents"("technicianId")
  WHERE "type" = 'NATIONAL_ID'
    AND "status" IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED');

-- 7. Partial unique indexes for live certificate rows.
CREATE UNIQUE INDEX "technician_documents_live_cert_real_key"
  ON "technician_documents"("technicianId", "categoryId", "certificateType")
  WHERE "type" = 'CERTIFICATE'
    AND "status" IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED')
    AND "categoryId" IS NOT NULL;

CREATE UNIQUE INDEX "technician_documents_live_cert_custom_key"
  ON "technician_documents"("technicianId", "customCategoryNormalized", "certificateType")
  WHERE "type" = 'CERTIFICATE'
    AND "status" IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED')
    AND "categoryId" IS NULL
    AND "customCategoryNormalized" IS NOT NULL;