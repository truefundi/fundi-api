-- Price negotiation for a job: one conversation per job, holding the service
-- request and a bounded offer/counter-offer exchange. Additive; existing tables
-- are only referenced by foreign key.
CREATE TYPE "ConversationStatus" AS ENUM ('NEGOTIATING', 'AGREED', 'DECLINED', 'EXPIRED');
CREATE TYPE "ConversationSender" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'SYSTEM');
CREATE TYPE "ConversationMessageType" AS ENUM ('SERVICE_REQUEST', 'TEXT', 'PRICE_OFFER', 'SYSTEM');
CREATE TYPE "PriceOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'EXPIRED');

CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'NEGOTIATING',
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "agreedAmount" INTEGER,
    "offerCount" INTEGER NOT NULL DEFAULT 0,
    "declinedById" TEXT,
    "declineReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "senderRole" "ConversationSender" NOT NULL,
    "type" "ConversationMessageType" NOT NULL,
    "text" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_offers" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "senderRole" "ConversationSender" NOT NULL,
    "status" "PriceOfferStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversations_jobId_key" ON "conversations"("jobId");
CREATE UNIQUE INDEX "price_offers_messageId_key" ON "price_offers"("messageId");
CREATE INDEX "conversations_status_lastMessageAt_idx" ON "conversations"("status", "lastMessageAt");
CREATE INDEX "conversations_lastMessageAt_idx" ON "conversations"("lastMessageAt");
CREATE INDEX "conversation_messages_conversationId_createdAt_idx" ON "conversation_messages"("conversationId", "createdAt");
CREATE INDEX "price_offers_conversationId_status_idx" ON "price_offers"("conversationId", "status");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_offers" ADD CONSTRAINT "price_offers_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "conversation_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
