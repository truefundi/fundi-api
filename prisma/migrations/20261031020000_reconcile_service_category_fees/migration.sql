-- Reconcile fee storage with the single visit-fee model.
--
-- Earlier migrations added a nullable "bookingFee" on service_categories and
-- created the visit fees as double precision. The catalog now exposes one
-- non-negative integer visit fee (and emergency visit fee) in RWF, so normalize
-- both without rewriting migrations that environments have already applied.
ALTER TABLE "service_categories"
    DROP COLUMN IF EXISTS "bookingFee";

ALTER TABLE "service_categories"
    ALTER COLUMN "visitFee" TYPE INTEGER
    USING ROUND("visitFee"::numeric)::integer,
    ALTER COLUMN "visitFee" SET DEFAULT 0;

ALTER TABLE "service_categories"
    ALTER COLUMN "emergencyVisitFee" TYPE INTEGER
    USING ROUND("emergencyVisitFee"::numeric)::integer,
    ALTER COLUMN "emergencyVisitFee" SET DEFAULT 0;

-- Prisma's @updatedAt sets this in the client, so the schema declares no default.
ALTER TABLE "service_categories"
    ALTER COLUMN "updatedAt" DROP DEFAULT;
