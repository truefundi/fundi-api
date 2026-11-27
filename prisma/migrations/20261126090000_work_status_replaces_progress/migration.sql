-- One progress model: the technician's work status (with the client's
-- completion confirmation) replaces the two-sided customer/technician progress.

-- Carry jobs over before the old columns go.
UPDATE "jobs"
SET "workStatus" = 'COMPLETED'
WHERE "status" = 'COMPLETED' AND "workStatus" <> 'COMPLETED';

UPDATE "jobs"
SET "workStatus" = 'IN_PROGRESS'
WHERE "status" IN ('ASSIGNED', 'PAUSED')
  AND "workStatus" = 'PENDING'
  AND "technicianProgress" = 'IN_PROGRESS';

-- Marked finished but not confirmed yet: the client can confirm it now.
UPDATE "jobs"
SET "workStatus" = 'COMPLETED',
    "completionConfirmationDueAt" = COALESCE("completionConfirmationDueAt", CURRENT_TIMESTAMP)
WHERE "status" IN ('ASSIGNED', 'PAUSED')
  AND "workStatus" <> 'COMPLETED'
  AND "technicianProgress" = 'COMPLETED';

ALTER TABLE "jobs" DROP COLUMN "customerProgress",
DROP COLUMN "technicianProgress";

DROP TYPE "JobProgressStatus";
