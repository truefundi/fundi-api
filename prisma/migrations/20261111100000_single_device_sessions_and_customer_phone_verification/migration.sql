ALTER TABLE "refresh_tokens" ADD COLUMN "deviceId" TEXT;

ALTER TABLE "customer_phone_verifications"
ADD COLUMN "phoneNumber" TEXT;

UPDATE "customer_phone_verifications" AS verification
SET "phoneNumber" = customer."phoneNumber"
FROM "users" AS customer
WHERE verification."customerId" = customer."id";

ALTER TABLE "customer_phone_verifications"
ALTER COLUMN "phoneNumber" SET NOT NULL;
