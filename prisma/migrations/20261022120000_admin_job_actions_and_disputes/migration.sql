-- Admin job actions record why a job was cancelled, and disputes get their own
-- table so admins can list, inspect and resolve customer/technician disagreements.

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;

CREATE TYPE "DisputeOpenedBy" AS ENUM ('CUSTOMER', 'TECHNICIAN');
CREATE TYPE "DisputeOutcome" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'PARTIAL');

CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "openedBy" "DisputeOpenedBy" NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "DisputeOutcome",
    "amount" INTEGER,
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "disputes_jobId_key" ON "disputes"("jobId");
CREATE INDEX "disputes_resolvedAt_openedAt_idx" ON "disputes"("resolvedAt", "openedAt");

ALTER TABLE "disputes" ADD CONSTRAINT "disputes_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
