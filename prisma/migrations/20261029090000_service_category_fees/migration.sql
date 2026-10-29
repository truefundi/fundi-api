-- Add editable service metadata and booking fees to the catalog.
-- Fees are non-negative amounts in the job currency (see Job.currency).
ALTER TABLE "service_categories"
    ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "category" TEXT NOT NULL DEFAULT 'Home Services',
    ADD COLUMN "visitFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "emergencyVisitFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows keep a zero fee until an administrator sets one.
ALTER TABLE "service_categories"
    ADD CONSTRAINT "service_categories_visitFee_nonnegative" CHECK ("visitFee" >= 0),
    ADD CONSTRAINT "service_categories_emergencyVisitFee_nonnegative" CHECK ("emergencyVisitFee" >= 0);
