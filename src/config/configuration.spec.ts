// The production boot guard must refuse to start on the development secrets that
// are committed as fallbacks in configuration.ts, and on a shared access/refresh
// secret, because either would let tokens be minted from a published value.
describe('configuration production secrets', () => {
  const managedKeys = [
    'NODE_ENV',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'TOKEN_HASH_SECRET',
    'ADMIN_TOTP_ENCRYPTION_KEY',
  ] as const;
  const original: Partial<Record<(typeof managedKeys)[number], string>> = {};

  const setEnvironment = (values: Partial<Record<(typeof managedKeys)[number], string | undefined>>) => {
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

  // A fresh import keeps each case independent of the module cache.
  const load = () => {
    let loaded: (() => unknown) | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      loaded = require('./configuration').default;
    });
    return loaded!;
  };

  it('boots development with the built-in fallbacks', () => {
    setEnvironment({ NODE_ENV: 'development' });
    expect(() => load()()).not.toThrow();
  });

  it('refuses production when a secret is missing', () => {
    setEnvironment({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      TOKEN_HASH_SECRET: 'c'.repeat(32),
      ADMIN_TOTP_ENCRYPTION_KEY: 'd'.repeat(64),
    });
    delete process.env.TOKEN_HASH_SECRET;
    expect(() => load()()).toThrow('Missing required production secrets: TOKEN_HASH_SECRET');
  });

  it('refuses production when the access and refresh secrets match', () => {
    setEnvironment({
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'a'.repeat(32),
      TOKEN_HASH_SECRET: 'c'.repeat(32),
      ADMIN_TOTP_ENCRYPTION_KEY: 'd'.repeat(64),
    });
    expect(() => load()()).toThrow('must be different in production');
  });
});
