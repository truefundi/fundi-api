-- New conversations wait for the assigned technician's response. Kept in a
-- separate migration because Postgres rejects using a new enum value in the
-- same transaction that adds it.
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'PENDING';
