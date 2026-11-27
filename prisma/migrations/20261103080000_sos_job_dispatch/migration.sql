CREATE TYPE "JobRequestType" AS ENUM ('NORMAL', 'SOS');

ALTER TABLE "service_categories"
ADD COLUMN "sosBookingFee" INTEGER;

ALTER TABLE "jobs"
ADD COLUMN "requestType" "JobRequestType" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "booking_payments"
ADD COLUMN "requestType" "JobRequestType" NOT NULL DEFAULT 'NORMAL';
