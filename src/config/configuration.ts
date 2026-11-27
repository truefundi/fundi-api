import {
  DEV_ACCESS_SECRET_FALLBACK,
  DEV_REFRESH_SECRET_FALLBACK,
  DEV_TOKEN_HASH_SECRET_FALLBACK,
  isKnownDevFallbackSecret,
} from '../common/crypto/jwt-secrets';

const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/;

// Loads typed runtime settings from the process environment and fails fast outside development.
export default () => {
  const environment = process.env.NODE_ENV || 'development';

  // Anything outside local development ('production', 'staging', etc.) must never
  // boot with missing secrets, local disk storage, or published fallback keys.
  if (environment !== 'development') {
    const required = [
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'TOKEN_HASH_SECRET',
      'ADMIN_TOTP_ENCRYPTION_KEY',
      'NATIONAL_ID_ENCRYPTION_KEY',
      'WEBAUTHN_RP_ID',
      'WEBAUTHN_ORIGIN',
      'STORAGE_DRIVER',
      'S3_BUCKET',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ].filter((key) => !process.env[key]?.trim());

    if (required.length > 0) {
      throw new Error(
        `Missing required production secrets: ${required.join(', ')}`,
      );
    }

    if (process.env.STORAGE_DRIVER !== 's3') {
      throw new Error(
        `STORAGE_DRIVER must be "s3" when NODE_ENV is "${environment}".`,
      );
    }

    const secretKeysToCheck = [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'TOKEN_HASH_SECRET',
      'MOCK_PAYMENT_KEY',
      'MOCK_PAYMENT_SECRET',
    ] as const;
    const fallbackUsed = secretKeysToCheck.filter((key) =>
      isKnownDevFallbackSecret(process.env[key]),
    );
    if (fallbackUsed.length > 0) {
      throw new Error(
        `Refusing known development fallback secrets in ${environment}: ${fallbackUsed.join(', ')}`,
      );
    }

    if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET) {
      throw new Error(
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production.',
      );
    }

    if (!HEX_64_PATTERN.test(process.env.ADMIN_TOTP_ENCRYPTION_KEY!)) {
      throw new Error(
        'ADMIN_TOTP_ENCRYPTION_KEY must be 64 hexadecimal characters.',
      );
    }
    if (!HEX_64_PATTERN.test(process.env.NATIONAL_ID_ENCRYPTION_KEY!)) {
      throw new Error(
        'NATIONAL_ID_ENCRYPTION_KEY must be 64 hexadecimal characters.',
      );
    }
  }

  const isDev = environment === 'development';

  return {
    environment,
    port: parseInt(process.env.PORT || '3000', 10),
    database: {
      url: process.env.DATABASE_URL,
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      url: process.env.REDIS_URL || undefined,
      password: process.env.REDIS_PASSWORD || undefined,
      username: process.env.REDIS_USERNAME || undefined,
      db:
        process.env.REDIS_DB !== undefined && process.env.REDIS_DB !== ''
          ? parseInt(process.env.REDIS_DB, 10)
          : undefined,
      tls: process.env.REDIS_TLS === 'true',
    },
    sms: {
      mode:
        process.env.SMS_MODE || (isDev ? 'console' : 'provider'),
    },
    otp: {
      ttlSeconds: Number(process.env.OTP_TTL_SECONDS) || 300,
    },
    auth: {
      passwordBcryptRounds:
        Number(process.env.AUTH_PASSWORD_BCRYPT_ROUNDS) || 12,
      passwordMaxAttempts: Number(process.env.AUTH_PASSWORD_MAX_ATTEMPTS) || 5,
      passwordLockoutSeconds:
        Number(process.env.AUTH_PASSWORD_LOCKOUT_SECONDS) || 900,
      passkeyChallengeTtlSeconds:
        Number(process.env.PASSKEY_CHALLENGE_TTL_SECONDS) || 300,
    },
    webauthn: {
      rpId: process.env.WEBAUTHN_RP_ID || undefined,
      rpName: process.env.WEBAUTHN_RP_NAME || 'Fundi',
      origins: (process.env.WEBAUTHN_ORIGIN || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
    jwt: {
      accessSecret:
        process.env.JWT_ACCESS_SECRET ||
        (isDev ? DEV_ACCESS_SECRET_FALLBACK : undefined),
      refreshSecret:
        process.env.JWT_REFRESH_SECRET ||
        (isDev ? DEV_REFRESH_SECRET_FALLBACK : undefined),
      tokenHashSecret:
        process.env.TOKEN_HASH_SECRET ||
        (isDev
          ? process.env.JWT_REFRESH_SECRET || DEV_TOKEN_HASH_SECRET_FALLBACK
          : undefined),
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '7d',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    },
    adminAuth: {
      bcryptRounds: Number(process.env.ADMIN_BCRYPT_ROUNDS) || 12,
      maxLoginAttempts: Number(process.env.ADMIN_MAX_LOGIN_ATTEMPTS) || 5,
      loginLockoutSeconds:
        Number(process.env.ADMIN_LOGIN_LOCKOUT_SECONDS) || 900,
      twoFactorPendingSeconds:
        Number(process.env.ADMIN_2FA_PENDING_SECONDS) || 300,
      twoFactorMaxTries: Number(process.env.ADMIN_2FA_MAX_TRIES) || 5,
      totpIssuer: process.env.ADMIN_TOTP_ISSUER || 'Fundi',
      totpWindow: Number(process.env.ADMIN_TOTP_WINDOW) || 1,
      accessExpiresIn: process.env.ADMIN_ACCESS_EXPIRES_IN || '1d',
      refreshExpiresIn: process.env.ADMIN_REFRESH_EXPIRES_IN || '5d',
      devOtpEnabled:
        process.env.ADMIN_DEV_OTP_ENABLED !== undefined
          ? process.env.ADMIN_DEV_OTP_ENABLED === 'true'
          : environment !== 'production',
      cookie: {
        sameSite: process.env.ADMIN_COOKIE_SAME_SITE || 'lax',
        secure: process.env.ADMIN_COOKIE_SECURE
          ? process.env.ADMIN_COOKIE_SECURE === 'true'
          : environment === 'production',
        domain: process.env.ADMIN_COOKIE_DOMAIN || undefined,
      },
    },
    security: {
      totpEncryptionKey: process.env.ADMIN_TOTP_ENCRYPTION_KEY,
      nationalIdEncryptionKey: process.env.NATIONAL_ID_ENCRYPTION_KEY,
    },
    mockPayment: {
      key: process.env.MOCK_PAYMENT_KEY,
      secret: process.env.MOCK_PAYMENT_SECRET,
    },
    geocoding: {
      endpoint:
        process.env.GEOCODING_ENDPOINT ||
        'https://nominatim.openstreetmap.org/search',
      userAgent: process.env.GEOCODING_USER_AGENT || 'FundiBackend/0.1.0',
    },
    cors: {
      origins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
  };
};
