-- The admin's note when rejecting a technician application, shown to the technician.
ALTER TABLE "technician_profiles" ADD COLUMN "rejectionReason" TEXT;
