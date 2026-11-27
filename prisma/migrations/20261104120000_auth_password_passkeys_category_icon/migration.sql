-- Add nullable category icon identifiers.
ALTER TABLE "service_categories" ADD COLUMN "icon" TEXT;

-- Store public WebAuthn credential data; private keys remain on the user's device.
CREATE TABLE "passkey_credentials" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "passkey_credentials_credentialId_key"
    ON "passkey_credentials"("credentialId");
CREATE INDEX "passkey_credentials_userId_idx"
    ON "passkey_credentials"("userId");

ALTER TABLE "passkey_credentials"
    ADD CONSTRAINT "passkey_credentials_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
