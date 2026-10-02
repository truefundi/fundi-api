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
  security: {
    nationalIdEncryptionKey: process.env.NATIONAL_ID_ENCRYPTION_KEY,
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  },
  };
};
