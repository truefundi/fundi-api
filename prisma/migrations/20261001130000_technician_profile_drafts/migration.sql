-- Persist technician onboarding drafts separately from user login status.
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "technician_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "onboardingStep" INTEGER NOT NULL DEFAULT 1,
    "yearsOfExperience" INTEGER,
    "tin" TEXT,
    "baseAddress" TEXT,
    "baseLatitude" DOUBLE PRECISION,
    "baseLongitude" DOUBLE PRECISION,
    "serviceRadiusKm" INTEGER,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "technician_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "technician_profiles_userId_key" ON "technician_profiles"("userId");
CREATE INDEX "technician_profiles_verificationStatus_idx" ON "technician_profiles"("verificationStatus");

CREATE TABLE "technician_categories" (
    "technicianId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    CONSTRAINT "technician_categories_pkey" PRIMARY KEY ("technicianId", "categoryId")
);

CREATE INDEX "technician_categories_categoryId_idx" ON "technician_categories"("categoryId");

ALTER TABLE "technician_profiles"
  ADD CONSTRAINT "technician_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_categories"
  ADD CONSTRAINT "technician_categories_technicianId_fkey"
  FOREIGN KEY ("technicianId") REFERENCES "technician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "technician_categories"
  ADD CONSTRAINT "technician_categories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;