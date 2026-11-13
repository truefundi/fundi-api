CREATE TABLE "rating_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rating_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_ratings" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "customerId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "comment" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_ratings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rating_responses" (
    "id" TEXT NOT NULL,
    "jobRatingId" TEXT NOT NULL,
    "ratingItemId" TEXT NOT NULL,
    "itemNameSnapshot" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_responses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rating_responses_score_check" CHECK ("score" >= 1 AND "score" <= 5)
);

CREATE UNIQUE INDEX "rating_items_name_key" ON "rating_items"("name");
CREATE INDEX "rating_items_isActive_sortOrder_name_idx"
    ON "rating_items"("isActive", "sortOrder", "name");

CREATE UNIQUE INDEX "job_ratings_jobId_key" ON "job_ratings"("jobId");
CREATE INDEX "job_ratings_technicianId_submittedAt_idx"
    ON "job_ratings"("technicianId", "submittedAt");
CREATE INDEX "job_ratings_customerId_submittedAt_idx"
    ON "job_ratings"("customerId", "submittedAt");

CREATE UNIQUE INDEX "rating_responses_jobRatingId_ratingItemId_key"
    ON "rating_responses"("jobRatingId", "ratingItemId");
CREATE INDEX "rating_responses_ratingItemId_idx"
    ON "rating_responses"("ratingItemId");

ALTER TABLE "job_ratings"
    ADD CONSTRAINT "job_ratings_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "job_ratings_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "job_ratings_technicianId_fkey"
    FOREIGN KEY ("technicianId") REFERENCES "technician_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "job_ratings_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rating_responses"
    ADD CONSTRAINT "rating_responses_jobRatingId_fkey"
    FOREIGN KEY ("jobRatingId") REFERENCES "job_ratings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "rating_responses_ratingItemId_fkey"
    FOREIGN KEY ("ratingItemId") REFERENCES "rating_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
