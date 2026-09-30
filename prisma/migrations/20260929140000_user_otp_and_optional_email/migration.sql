-- Make email optional because phone number is the login identifier.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- Replace the old status enum and map any suspended accounts to inactive.
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');
ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "status" TYPE "UserStatus"
  USING (CASE WHEN "status"::text = 'SUSPENDED' THEN 'INACTIVE' ELSE "status"::text END)::"UserStatus";
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "UserStatus_old";

-- Store only hashed OTPs with expiry and abuse-control counters.
CREATE TABLE "login_otps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "verificationTries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "login_otps_pkey" PRIMARY KEY ("id")
);

-- Enforce one pending OTP per user and cascade cleanup when an account is deleted.
CREATE UNIQUE INDEX "login_otps_userId_key" ON "login_otps"("userId");
ALTER TABLE "login_otps" ADD CONSTRAINT "login_otps_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;