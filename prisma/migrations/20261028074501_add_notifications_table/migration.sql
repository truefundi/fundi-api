-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('JOB_OFFER', 'JOB_ASSIGNED', 'JOB_ACCEPTED', 'JOB_COMPLETED', 'JOB_CANCELLED', 'CONVERSATION_MESSAGE', 'OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'DOCUMENT_APPROVED', 'DOCUMENT_REJECTED', 'SYSTEM');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
