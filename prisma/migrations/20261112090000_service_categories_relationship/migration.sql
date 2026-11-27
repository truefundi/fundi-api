CREATE TABLE "catalog_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_categories_name_key" ON "catalog_categories"("name");

INSERT INTO "catalog_categories" ("id", "name", "description", "updatedAt")
VALUES (
    '014a8823-f6c4-4643-892f-c869d83a00aa',
    'Other Services',
    'Existing services migrated before service categories were introduced.',
    CURRENT_TIMESTAMP
);

ALTER TABLE "service_categories" ADD COLUMN "categoryId" TEXT;

UPDATE "service_categories"
SET "categoryId" = '014a8823-f6c4-4643-892f-c869d83a00aa';

ALTER TABLE "service_categories"
    ALTER COLUMN "categoryId" SET NOT NULL,
    DROP COLUMN "category";

CREATE INDEX "service_categories_categoryId_idx"
    ON "service_categories"("categoryId");

ALTER TABLE "service_categories"
    ADD CONSTRAINT "service_categories_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "catalog_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
