CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "JobStatus" AS ENUM ('OPEN', 'ASSIGNED', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "JobDispatchStatus" AS ENUM ('PENDING', 'OFFERED', 'EXHAUSTED', 'STOPPED');
CREATE TYPE "JobProgressStatus" AS ENUM ('PENDING', 'STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
CREATE TYPE "JobOfferStatus" AS ENUM ('WAITING', 'OFFERED', 'REJECTED', 'EXPIRED', 'ACCEPTED', 'DROPPED', 'CANCELLED');
CREATE TYPE "JobMediaType" AS ENUM ('PHOTO', 'VIDEO');

CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "technicianId" TEXT,
    "serviceCategoryId" TEXT,
    "otherServiceName" TEXT,
    "description" TEXT NOT NULL,
    "locationAddress" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326),
    "offeredAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "JobStatus" NOT NULL DEFAULT 'OPEN',
    "dispatchStatus" "JobDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "dispatchRound" INTEGER NOT NULL DEFAULT 1,
    "customerProgress" "JobProgressStatus" NOT NULL DEFAULT 'PENDING',
    "technicianProgress" "JobProgressStatus" NOT NULL DEFAULT 'PENDING',
    "assignedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_offers" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "matchScore" INTEGER NOT NULL,
    "distanceMeters" DOUBLE PRECISION NOT NULL,
    "status" "JobOfferStatus" NOT NULL DEFAULT 'WAITING',
    "offeredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "dropReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_media" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "JobMediaType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_assignment_history" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "technicianId" TEXT,
    "technicianName" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_assignment_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "job_media_objectKey_key" ON "job_media"("objectKey");
CREATE UNIQUE INDEX "job_offers_jobId_technicianId_round_key" ON "job_offers"("jobId", "technicianId", "round");
CREATE INDEX "jobs_customerId_createdAt_idx" ON "jobs"("customerId", "createdAt");
CREATE INDEX "jobs_technicianId_status_updatedAt_idx" ON "jobs"("technicianId", "status", "updatedAt");
CREATE INDEX "jobs_status_dispatchStatus_priority_createdAt_idx" ON "jobs"("status", "dispatchStatus", "priority", "createdAt");
CREATE INDEX "jobs_serviceCategoryId_idx" ON "jobs"("serviceCategoryId");
CREATE INDEX "technician_profiles_baseLocation_gist_idx"
    ON "technician_profiles" USING GIST ("baseLocation");
CREATE INDEX "job_offers_jobId_round_status_matchScore_idx" ON "job_offers"("jobId", "round", "status", "matchScore");
CREATE INDEX "job_offers_technicianId_status_updatedAt_idx" ON "job_offers"("technicianId", "status", "updatedAt");
CREATE INDEX "job_media_jobId_createdAt_idx" ON "job_media"("jobId", "createdAt");
CREATE INDEX "job_assignment_history_jobId_acceptedAt_idx" ON "job_assignment_history"("jobId", "acceptedAt");
CREATE INDEX "job_assignment_history_technicianId_acceptedAt_idx" ON "job_assignment_history"("technicianId", "acceptedAt");

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_technicianId_fkey"
    FOREIGN KEY ("technicianId") REFERENCES "technician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_serviceCategoryId_fkey"
    FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_offers" ADD CONSTRAINT "job_offers_technicianId_fkey"
    FOREIGN KEY ("technicianId") REFERENCES "technician_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_media" ADD CONSTRAINT "job_media_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_assignment_history" ADD CONSTRAINT "job_assignment_history_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_assignment_history" ADD CONSTRAINT "job_assignment_history_technicianId_fkey"
    FOREIGN KEY ("technicianId") REFERENCES "technician_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
