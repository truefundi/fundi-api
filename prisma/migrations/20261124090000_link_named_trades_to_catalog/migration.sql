-- Trades and certificates saved under a typed name that matches an active
-- catalog service are linked to that service, so jobs for it (matched by
-- category id) reach the technician.

-- A by-name trade the technician already lists by id is a duplicate.
DELETE FROM "technician_categories" tc
USING "service_categories" sc
WHERE tc."categoryId" IS NULL
  AND sc."isActive" = TRUE
  AND LOWER(BTRIM(tc."customName")) = LOWER(BTRIM(sc."name"))
  AND EXISTS (
    SELECT 1 FROM "technician_categories" o
    WHERE o."technicianId" = tc."technicianId" AND o."categoryId" = sc."id"
  );

UPDATE "technician_categories" tc
SET "categoryId" = sc."id", "customName" = NULL, "customNameNormalized" = ''
FROM "service_categories" sc
WHERE tc."categoryId" IS NULL
  AND sc."isActive" = TRUE
  AND LOWER(BTRIM(tc."customName")) = LOWER(BTRIM(sc."name"));

-- Certificates: skip one that would clash with a live certificate already
-- linked to the same service and certificate type.
UPDATE "technician_documents" d
SET "categoryId" = sc."id", "customCategoryName" = NULL, "customCategoryNormalized" = NULL
FROM "service_categories" sc
WHERE d."type" = 'CERTIFICATE'
  AND d."categoryId" IS NULL
  AND sc."isActive" = TRUE
  AND LOWER(BTRIM(d."customCategoryName")) = LOWER(BTRIM(sc."name"))
  AND NOT (
    d."status" IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED')
    AND EXISTS (
      SELECT 1 FROM "technician_documents" o
      WHERE o."id" <> d."id"
        AND o."technicianId" = d."technicianId"
        AND o."type" = 'CERTIFICATE'
        AND o."categoryId" = sc."id"
        AND o."certificateType" IS NOT DISTINCT FROM d."certificateType"
        AND o."status" IN ('SUBMITTED', 'REVIEWING', 'ACCEPTED')
    )
  );
