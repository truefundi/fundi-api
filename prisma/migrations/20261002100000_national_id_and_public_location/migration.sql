-- Store technician national IDs encrypted, with a keyed unique digest, and a safe public location label.
ALTER TABLE "technician_profiles"
  ADD COLUMN "nationalIdEncrypted" TEXT,
  ADD COLUMN "nationalIdHash" TEXT,
  ADD COLUMN "publicLocationLabel" TEXT;

CREATE UNIQUE INDEX "technician_profiles_nationalIdHash_key"
  ON "technician_profiles"("nationalIdHash");