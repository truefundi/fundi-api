-- Store the customer's post-job rating on the job itself. Kept nullable so
-- existing and unrated jobs remain valid.
ALTER TABLE "jobs"
    ADD COLUMN "ratingOverall" INTEGER,
    ADD COLUMN "ratingQuality" INTEGER,
    ADD COLUMN "ratingProfessionalism" INTEGER,
    ADD COLUMN "ratingArrival" INTEGER,
    ADD COLUMN "ratingCommunication" INTEGER,
    ADD COLUMN "ratingValue" INTEGER,
    ADD COLUMN "ratingComment" TEXT,
    ADD COLUMN "ratedAt" TIMESTAMP(3);

-- Ratings are whole stars from 1 to 5.
ALTER TABLE "jobs"
    ADD CONSTRAINT "jobs_ratingOverall_check" CHECK ("ratingOverall" IS NULL OR ("ratingOverall" BETWEEN 1 AND 5)),
    ADD CONSTRAINT "jobs_ratingQuality_check" CHECK ("ratingQuality" IS NULL OR ("ratingQuality" BETWEEN 1 AND 5)),
    ADD CONSTRAINT "jobs_ratingProfessionalism_check" CHECK ("ratingProfessionalism" IS NULL OR ("ratingProfessionalism" BETWEEN 1 AND 5)),
    ADD CONSTRAINT "jobs_ratingArrival_check" CHECK ("ratingArrival" IS NULL OR ("ratingArrival" BETWEEN 1 AND 5)),
    ADD CONSTRAINT "jobs_ratingCommunication_check" CHECK ("ratingCommunication" IS NULL OR ("ratingCommunication" BETWEEN 1 AND 5)),
    ADD CONSTRAINT "jobs_ratingValue_check" CHECK ("ratingValue" IS NULL OR ("ratingValue" BETWEEN 1 AND 5));
