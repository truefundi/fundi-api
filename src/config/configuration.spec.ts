// Startup boot guard tests: outside development, missing critical secrets,
// non-S3 storage, or published development fallback values must abort boot.
describe('configuration production secrets', () => {
  const managedKeys = [
    'NODE_ENV',
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
    'MOCK_PAYMENT_KEY',
    'MOCK_PAYMENT_SECRET',
  ] as const;
  const original: Partial<Record<(typeof managedKeys)[number], string>> = {};

  const validProdEnv: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@postgres:5432/fundi_db?schema=public',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    TOKEN_HASH_SECRET: 'c'.repeat(32),
    ADMIN_TOTP_ENCRYPTION_KEY: 'd'.repeat(64),
    NATIONAL_ID_ENCRYPTION_KEY: 'e'.repeat(64),
    WEBAUTHN_RP_ID: 'api.example.com',
    WEBAUTHN_ORIGIN: 'https://app.example.com',
    STORAGE_DRIVER: 's3',
    S3_BUCKET: 'fundi-private',
    S3_ENDPOINT: 'https://s3.example.com',
    S3_ACCESS_KEY_ID: 'prod-access-key',
    S3_SECRET_ACCESS_KEY: 'prod-secret-key',
  };

  const setEnvironment = (
    values: Partial<Record<(typeof managedKeys)[number], string | undefined>>,
  ) => {
    for (const key of managedKeys) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  beforeAll(() => {
    for (const key of managedKeys) original[key] = process.env[key];
  });

  afterEach(() => setEnvironment(original));

  const load = () => {
    let loaded: (() => unknown) | undefined;
    jest.isolateModules(() => {
      loaded = require('./configuration').default;
    });
    return loaded!;
  };

  it('boots development with the built-in fallbacks', () => {
    setEnvironment({ NODE_ENV: 'development' });
    expect(() => load()()).not.toThrow();
  });

  it('boots production when all required secrets and S3 settings are provided', () => {
    setEnvironment(validProdEnv);
    expect(() => load()()).not.toThrow();
  });

  it('refuses production when DATABASE_URL, NATIONAL_ID_ENCRYPTION_KEY, or TOKEN_HASH_SECRET is missing', () => {
    setEnvironment({ ...validProdEnv, TOKEN_HASH_SECRET: undefined });
    expect(() => load()()).toThrow(
      'Missing required production secrets: TOKEN_HASH_SECRET',
    );

    setEnvironment({ ...validProdEnv, DATABASE_URL: undefined });
    expect(() => load()()).toThrow(
      'Missing required production secrets: DATABASE_URL',
    );

    setEnvironment({ ...validProdEnv, NATIONAL_ID_ENCRYPTION_KEY: undefined });
    expect(() => load()()).toThrow(
      'Missing required production secrets: NATIONAL_ID_ENCRYPTION_KEY',
    );
  });

  it('refuses non-development environments when STORAGE_DRIVER is not s3', () => {
    setEnvironment({
      ...validProdEnv,
      NODE_ENV: 'staging',
      STORAGE_DRIVER: 'local',
    });
    expect(() => load()()).toThrow('STORAGE_DRIVER must be "s3"');
  });

  it('refuses known development fallback secrets whenever NODE_ENV !== development', () => {
    setEnvironment({
      ...validProdEnv,
      NODE_ENV: 'staging',
      JWT_ACCESS_SECRET: 'default_dev_access_secret_32chars',
    });
    expect(() => load()()).toThrow(
      'Refusing known development fallback secrets in staging: JWT_ACCESS_SECRET',
    );
  });

  it('refuses production when the access and refresh secrets match', () => {
    setEnvironment({
      ...validProdEnv,
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'a'.repeat(32),
    });
    expect(() => load()()).toThrow('must be different in production');
  });
});
