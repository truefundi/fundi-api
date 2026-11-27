CREATE TYPE "JobCooperationStatus" AS ENUM ('PENDING', 'CONFIRMED');

ALTER TABLE "jobs"
  ADD COLUMN "cooperationStatus" "JobCooperationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "customerConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "technicianConfirmedAt" TIMESTAMP(3);
