-- The conversation now carries the job request until the assigned technician
-- accepts or declines it. Additive enum changes only; Postgres requires the new
-- values to be committed before they can be used, so the column default moves
-- to the next migration.
ALTER TYPE "ConversationStatus" ADD VALUE 'PENDING';
ALTER TYPE "ConversationMessageType" ADD VALUE 'TECHNICIAN_RESPONSE';
