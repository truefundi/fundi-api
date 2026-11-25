CREATE TYPE "JobWorkStatus" AS ENUM (
    'PENDING',
    'HEADING_TO_LOCATION',
    'ARRIVED',
    'IN_PROGRESS',
    'ON_HOLD',
    'COMPLETED'
);

ALTER TABLE "jobs"
ADD COLUMN "companyId" TEXT,
ADD COLUMN "workStatus" "JobWorkStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "workStatusReason" TEXT,
ADD COLUMN "completionConfirmationDueAt" TIMESTAMP(3),
ADD COLUMN "completionConfirmedAt" TIMESTAMP(3),
ADD COLUMN "completionAutoCompletedAt" TIMESTAMP(3);

ALTER TABLE "technician_profiles"
ADD COLUMN "capacityAutoOffline" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "jobs_companyId_idx" ON "jobs"("companyId");

ALTER TABLE "jobs"
ADD CONSTRAINT "jobs_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "companies"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "technician_document_services" (
    "documentId" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technician_document_services_pkey" PRIMARY KEY ("documentId", "serviceCategoryId")
);

INSERT INTO "technician_document_services" ("documentId", "serviceCategoryId")
SELECT "id", "categoryId"
FROM "technician_documents"
WHERE "categoryId" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE INDEX "technician_document_services_serviceCategoryId_idx"
ON "technician_document_services"("serviceCategoryId");

ALTER TABLE "technician_document_services"
ADD CONSTRAINT "technician_document_services_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "technician_documents"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_document_services"
ADD CONSTRAINT "technician_document_services_serviceCategoryId_fkey"
FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
