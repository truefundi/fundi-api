// Loads typed runtime settings from the process environment.
export default () => {
  const environment = process.env.NODE_ENV || 'development';
  return {
  environment,
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  sms: {
    mode: process.env.SMS_MODE || (environment === 'development' ? 'console' : 'provider'),
  },
  otp: {
    // OTP lifetime in seconds. `|| 300` also swallows a non-numeric value.
    ttlSeconds: Number(process.env.OTP_TTL_SECONDS) || 300,
  },
  jwt: {
    accessSecret:
      process.env.JWT_ACCESS_SECRET || 'default_dev_access_secret_32chars',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || 'default_dev_refresh_secret_32chars',
    tokenHashSecret:
      process.env.TOKEN_HASH_SECRET || process.env.JWT_REFRESH_SECRET || 'development_token_hash_secret_change_before_production',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  adminAuth: {
    // bcrypt work factor. Higher is slower and safer; 12 is a sane production default.
    bcryptRounds: Number(process.env.ADMIN_BCRYPT_ROUNDS) || 12,
    // Wrong-password lockout, keyed by a hash of the email so unknown addresses are covered too.
    maxLoginAttempts: Number(process.env.ADMIN_MAX_LOGIN_ATTEMPTS) || 5,
    loginLockoutSeconds: Number(process.env.ADMIN_LOGIN_LOCKOUT_SECONDS) || 900,
    // How long a password-verified sign-in stays open waiting for a code. Not a code
    // lifetime: a TOTP code is valid for 30s by the authenticator's own clock, and
    // there is nothing to resend, so this only bounds an abandoned sign-in.
    twoFactorPendingSeconds: Number(process.env.ADMIN_2FA_PENDING_SECONDS) || 300,
    // Wrong codes allowed per account. More important than the SMS version: a TOTP
    // space is six digits and each code is live for 30s, so guessing is cheaper.
    twoFactorMaxTries: Number(process.env.ADMIN_2FA_MAX_TRIES) || 5,
    // Label the authenticator app shows, and the issuer in the otpauth:// URI. It has
    // to match in both the label and the query parameter or the scan is rejected.
    totpIssuer: process.env.ADMIN_TOTP_ISSUER || 'Fundi',
    // Steps of clock drift tolerated either side of the current one. One step absorbs
    // ordinary server/client clock skew without meaningfully widening the guess space.
    totpWindow: Number(process.env.ADMIN_TOTP_WINDOW) || 1,
    accessExpiresIn: process.env.ADMIN_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.ADMIN_REFRESH_EXPIRES_IN || '12h',
    cookie: {
      // 'none' is only honoured by browsers when secure is also true.
      sameSite: process.env.ADMIN_COOKIE_SAME_SITE || 'lax',
      secure: process.env.ADMIN_COOKIE_SECURE
        ? process.env.ADMIN_COOKIE_SECURE === 'true'
        : environment === 'production',
      // Leave unset unless the admin dashboard is on its own subdomain.
      domain: process.env.ADMIN_COOKIE_DOMAIN || undefined,
    },
  },
  security: {
    nationalIdEncryptionKey: process.env.NATIONAL_ID_ENCRYPTION_KEY,
    totpEncryptionKey: process.env.ADMIN_TOTP_ENCRYPTION_KEY,
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  },
  };
};
