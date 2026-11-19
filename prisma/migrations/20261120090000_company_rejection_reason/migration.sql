-- The admin's note when rejecting a company, shown to its owner.
ALTER TABLE "companies" ADD COLUMN "rejectionReason" TEXT;
