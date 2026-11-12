-- Create the promotion and broadcast surfaces used by the admin dashboard.

CREATE TYPE "AdBadge" AS ENUM ('LIVE', 'COMING_SOON');
CREATE TYPE "AdPlacement" AS ENUM ('LANDING_PRODUCT', 'LANDING_HERO', 'MOBILE_HOME', 'MOBILE_JOB_FEED');
CREATE TYPE "AdAudience" AS ENUM ('ALL', 'CUSTOMER', 'TECHNICIAN');
CREATE TYPE "BroadcastRole" AS ENUM ('CUSTOMER', 'TECHNICIAN');
CREATE TYPE "BroadcastChannel" AS ENUM ('SMS', 'IN_APP');
CREATE TYPE "BroadcastStatus" AS ENUM ('SENDING', 'SENT', 'PARTIAL', 'FAILED');

CREATE TABLE "ads" (
    "id" TEXT NOT NULL,
    "productId" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imageKey" TEXT,
    "imageContentType" TEXT,
    "imageAlt" TEXT,
    "callToAction" TEXT,
    "badge" "AdBadge" NOT NULL DEFAULT 'LIVE',
    "placement" "AdPlacement" NOT NULL DEFAULT 'LANDING_PRODUCT',
    "audience" "AdAudience" NOT NULL DEFAULT 'ALL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "broadcasts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "roles" "BroadcastRole"[] DEFAULT ARRAY[]::"BroadcastRole"[],
    "channels" "BroadcastChannel"[] DEFAULT ARRAY[]::"BroadcastChannel"[],
    "status" "BroadcastStatus" NOT NULL DEFAULT 'SENDING',
    "mode" TEXT NOT NULL DEFAULT 'queued',
    "userCount" INTEGER NOT NULL DEFAULT 0,
    "smsRecipientCount" INTEGER NOT NULL DEFAULT 0,
    "inAppRecipientCount" INTEGER NOT NULL DEFAULT 0,
    "smsSentCount" INTEGER NOT NULL DEFAULT 0,
    "smsFailedCount" INTEGER NOT NULL DEFAULT 0,
    "inAppSentCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ads_placement_isActive_priority_idx" ON "ads"("placement", "isActive", "priority");
CREATE INDEX "ads_startsAt_endsAt_idx" ON "ads"("startsAt", "endsAt");
CREATE INDEX "broadcasts_createdAt_idx" ON "broadcasts"("createdAt");

ALTER TABLE "ads" ADD CONSTRAINT "ads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Broadcasts land in the same inbox as every other notification.
ALTER TYPE "NotificationType" ADD VALUE 'BROADCAST';
