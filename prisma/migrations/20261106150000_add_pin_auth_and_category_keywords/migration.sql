ALTER TABLE "users" ADD COLUMN "pinHash" TEXT;

ALTER TABLE "service_categories"
ADD COLUMN "keywords" TEXT NOT NULL DEFAULT '';
