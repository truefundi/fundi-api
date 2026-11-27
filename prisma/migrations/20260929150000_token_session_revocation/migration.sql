-- Add a shared identifier so either token can be revoked with its session record.
ALTER TABLE "refresh_tokens" ADD COLUMN "sessionId" TEXT;
UPDATE "refresh_tokens" SET "sessionId" = "id" WHERE "sessionId" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "sessionId" SET NOT NULL;
CREATE UNIQUE INDEX "refresh_tokens_sessionId_key" ON "refresh_tokens"("sessionId");