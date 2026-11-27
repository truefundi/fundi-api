import { ConfigService } from '@nestjs/config';

export const DEV_ACCESS_SECRET_FALLBACK = 'default_dev_access_secret_32chars';
export const DEV_REFRESH_SECRET_FALLBACK = 'default_dev_refresh_secret_32chars';
export const DEV_TOKEN_HASH_SECRET_FALLBACK =
  'development_token_hash_secret_change_before_production';

export const KNOWN_DEV_FALLBACK_SECRETS = new Set<string>([
  DEV_ACCESS_SECRET_FALLBACK,
  DEV_REFRESH_SECRET_FALLBACK,
  DEV_TOKEN_HASH_SECRET_FALLBACK,
  'dev_jwt_access_secret_change_in_production_32chars',
  'dev_jwt_refresh_secret_change_in_production_32chars',
  'dev_token_hash_secret_change_in_production_32chars',
  'development_mock_payment_key',
  'development_mock_payment_secret_change_before_production',
  'replace_with_64_hex_char_secret',
]);

export function isKnownDevFallbackSecret(value?: string | null): boolean {
  if (!value) return false;
  return KNOWN_DEV_FALLBACK_SECRETS.has(value.trim());
}

export function resolveRuntimeEnvironment(
  configService?: ConfigService,
): string {
  return (
    configService?.get<string>('environment') ||
    process.env.NODE_ENV ||
    'development'
  );
}

/**
 * Reads a signing/hashing secret from ConfigService and refuses missing or
 * published development fallback values whenever NODE_ENV !== 'development'.
 */
export function getRequiredSecret(
  configService: ConfigService,
  key: string,
  devFallback?: string,
  secondaryKey?: string,
): string {
  const environment = resolveRuntimeEnvironment(configService);
  const primary = configService.get<string>(key);
  const secondary = secondaryKey
    ? configService.get<string>(secondaryKey)
    : undefined;
  const candidate = primary || secondary;

  if (environment !== 'development') {
    if (!candidate) {
      throw new Error(
        `Missing required secret "${key}" in ${environment} environment.`,
      );
    }
    if (isKnownDevFallbackSecret(candidate)) {
      throw new Error(
        `Refusing known development fallback secret for "${key}" in ${environment} environment.`,
      );
    }
    return candidate;
  }

  const resolved = candidate || devFallback;
  if (!resolved) {
    throw new Error(`Missing secret "${key}".`);
  }
  return resolved;
}
