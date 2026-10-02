-- Replace draft onboarding state with administrator-controlled verification.
ALTER TYPE "VerificationStatus" RENAME TO "VerificationStatus_old";
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "technician_profiles" ALTER COLUMN "verificationStatus" DROP DEFAULT;
ALTER TABLE "technician_profiles"
  ALTER COLUMN "verificationStatus" TYPE "VerificationStatus"
  USING (CASE WHEN "verificationStatus"::text = 'DRAFT' THEN 'PENDING' ELSE "verificationStatus"::text END)::"VerificationStatus";
ALTER TABLE "technician_profiles" ALTER COLUMN "verificationStatus" SET DEFAULT 'PENDING';
DROP TYPE "VerificationStatus_old";

-- Remove wizard-only and unrequested fields from the technician profile.
ALTER TABLE "technician_profiles"
  DROP COLUMN "onboardingStep",
  DROP COLUMN "tin",
  DROP COLUMN "serviceRadiusKm";

-- Store gender, an optional image in PostgreSQL bytea, and online/offline state.
CREATE TYPE "TechnicianAvailability" AS ENUM ('ONLINE', 'OFFLINE');
CREATE TYPE "TechnicianGender" AS ENUM ('FEMALE', 'MALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY');
ALTER TABLE "technician_profiles"
  ADD COLUMN "gender" "TechnicianGender",
  ADD COLUMN "profilePicture" BYTEA,
  ADD COLUMN "profilePictureMimeType" TEXT,
  ADD COLUMN "availabilityStatus" "TechnicianAvailability" NOT NULL DEFAULT 'OFFLINE',
  ADD COLUMN "baseLocation" geography(Point,4326);

-- Keep the PostGIS point synchronized from the persisted latitude/longitude fields.
UPDATE "technician_profiles"
SET "baseLocation" = ST_SetSRID(ST_MakePoint("baseLongitude", "baseLatitude"), 4326)::geography
WHERE "baseLatitude" IS NOT NULL AND "baseLongitude" IS NOT NULL;

CREATE INDEX "technician_profiles_availabilityStatus_verificationStatus_idx"
  ON "technician_profiles"("availabilityStatus", "verificationStatus");
CREATE INDEX "technician_profiles_baseLocation_idx"
  ON "technician_profiles" USING GIST ("baseLocation");