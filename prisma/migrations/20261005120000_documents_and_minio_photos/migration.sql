-- Move technician profile photos out of PostgreSQL bytea and add KYC documents.

ALTER TABLE "technician_profiles"
  ADD COLUMN "profilePictureObjectKey" TEXT;

ALTER TABLE "technician_profiles"
  DROP COLUMN IF EXISTS "profilePicture";

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NATIONAL_ID', 'TVET_CERTIFICATE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'ACCEPTED', 'DENIED');

CREATE TABLE "technician_documents" (
  "id" TEXT NOT NULL,
  "technicianId" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL,
  "title" TEXT NOT NULL,
  "titleNormalized" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "technician_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "technician_documents_technicianId_status_idx"
  ON "technician_documents"("technicianId", "status");

CREATE INDEX "technician_documents_status_idx"
  ON "technician_documents"("status");

CREATE INDEX "technician_documents_type_idx"
  ON "technician_documents"("type");

-- A technician may reuse a title only after the previous document with that title is denied.
CREATE UNIQUE INDEX "technician_documents_live_title_key"
  ON "technician_documents"("technicianId", "titleNormalized")
  WHERE "status" IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED');

-- Only one live national-ID scan per technician.
CREATE UNIQUE INDEX "technician_documents_live_national_id_key"
  ON "technician_documents"("technicianId")
  WHERE "type" = 'NATIONAL_ID' AND "status" IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED');

ALTER TABLE "technician_documents"
  ADD CONSTRAINT "technician_documents_technicianId_fkey"
  FOREIGN KEY ("technicianId") REFERENCES "technician_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
