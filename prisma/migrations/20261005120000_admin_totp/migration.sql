-- Second factor for admins moves from an SMS code to an authenticator app (TOTP).
--
-- totpSecret holds the base32 shared secret encrypted with AES-256-GCM, so it cannot
-- be hashed: the server has to read it back to compute the expected code. NULL until
-- an admin confirms a first code, so an abandoned enrolment leaves nothing behind.
--
-- totpEnabledAt distinguishes a confirmed enrolment from a half-finished one. It is
-- not used for authorization, only to record when the factor became usable.
ALTER TABLE "users" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "users" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);

-- No index. Lookups are by email and then by id, never by the secret, so an index
-- would only expose the ciphertext to a wider set of queries.