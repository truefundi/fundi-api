-- Human-readable job reference (FD-MMYYNNN) shown in the UI next to the UUID.
-- One counter row per month; the job creation transaction allocates atomically.
CREATE TABLE "job_number_counters" (
    "monthKey" TEXT NOT NULL PRIMARY KEY,
    "lastNumber" INTEGER NOT NULL
);

ALTER TABLE "jobs" ADD COLUMN "reference" TEXT;

-- Backfill existing jobs with their creation month and a per-month sequence,
-- oldest first, so FD numbers roughly match creation order.
WITH numbered AS (
  SELECT "id",
    row_number() OVER (
      PARTITION BY to_char("createdAt" AT TIME ZONE 'Africa/Kigali', 'MMYY')
      ORDER BY "createdAt", "id"
    ) AS "n"
  FROM "jobs"
)
UPDATE "jobs" AS j
SET "reference" =
  'FD-' || to_char(j."createdAt" AT TIME ZONE 'Africa/Kigali', 'MMYY') || lpad(n."n"::text, 3, '0')
FROM numbered AS n
WHERE j."id" = n."id";

ALTER TABLE "jobs" ALTER COLUMN "reference" SET NOT NULL;

CREATE UNIQUE INDEX "jobs_reference_key" ON "jobs"("reference");

-- Seed the counters from the backfilled months so the next allocation for an
-- existing month continues the sequence instead of colliding with a
-- backfilled reference.
WITH numbered AS (
  SELECT to_char("createdAt" AT TIME ZONE 'Africa/Kigali', 'MMYY') AS "monthKey",
    row_number() OVER (
      PARTITION BY to_char("createdAt" AT TIME ZONE 'Africa/Kigali', 'MMYY')
      ORDER BY "createdAt", "id"
    ) AS "n"
  FROM "jobs"
)
INSERT INTO "job_number_counters" ("monthKey", "lastNumber")
SELECT "monthKey", MAX("n")
FROM numbered
GROUP BY "monthKey";
