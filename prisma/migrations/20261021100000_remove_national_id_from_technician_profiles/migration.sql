-- National ID verification remains document-based; remove ID values from technician profiles.
DROP INDEX IF EXISTS "technician_profiles_nationalIdHash_key";

ALTER TABLE "technician_profiles"
  DROP COLUMN IF EXISTS "nationalIdEncrypted",
  DROP COLUMN IF EXISTS "nationalIdHash";
