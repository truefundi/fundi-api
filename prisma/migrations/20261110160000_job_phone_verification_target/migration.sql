-- The phone number a job verification code was sent to. It is written to the
-- customer account only after the code is verified.
ALTER TABLE "customer_phone_verifications" ADD COLUMN "phoneNumber" TEXT;
