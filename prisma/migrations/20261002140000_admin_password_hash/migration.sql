-- Add a nullable password hash so admins can sign in with email + password.
-- Nullable because customers and technicians authenticate with a phone OTP.
-- No index: bcrypt salts each hash, so this column is only ever looked up by id.
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;
