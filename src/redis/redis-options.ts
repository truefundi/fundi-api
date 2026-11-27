import { ConfigService } from '@nestjs/config';
import type { RedisOptions } from 'ioredis';

/**
 * Parses REDIS_URL (redis:// or rediss:// with optional username, password,
 * port, and db index) and merges explicit REDIS_* fallbacks.
 */
export function parseRedisOptions(configService: ConfigService): RedisOptions {
  const rawUrl =
    configService.get<string>('redis.url') || process.env.REDIS_URL;
  const fallbackHost = configService.get<string>('redis.host', 'localhost');
  const fallbackPort = configService.get<number>('redis.port', 6379);
  const fallbackPassword =
    configService.get<string>('redis.password') ||
    process.env.REDIS_PASSWORD ||
    undefined;
  const fallbackUsername =
    configService.get<string>('redis.username') ||
    process.env.REDIS_USERNAME ||
    undefined;
  const fallbackDb = configService.get<number>('redis.db');
  const forceTls =
    configService.get<boolean>('redis.tls') ||
    process.env.REDIS_TLS === 'true';

  if (rawUrl) {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      throw new Error(
        `Unsupported REDIS_URL protocol "${parsed.protocol}". Expected redis:// or rediss://.`,
      );
    }
    const dbSegment = parsed.pathname?.replace(/^\//, '');
    const parsedDb =
      dbSegment && /^\d+$/.test(dbSegment) ? Number(dbSegment) : fallbackDb;
    const isTls = parsed.protocol === 'rediss:' || forceTls;

    return {
      host: parsed.hostname || fallbackHost,
      port: parsed.port ? Number(parsed.port) : fallbackPort,
      ...(parsed.username
        ? { username: decodeURIComponent(parsed.username) }
        : fallbackUsername
          ? { username: fallbackUsername }
          : {}),
      ...(parsed.password
        ? { password: decodeURIComponent(parsed.password) }
        : fallbackPassword
          ? { password: fallbackPassword }
          : {}),
      ...(parsedDb !== undefined ? { db: parsedDb } : {}),
      ...(isTls ? { tls: { servername: parsed.hostname || fallbackHost } } : {}),
    };
  }

  return {
    host: fallbackHost,
    port: fallbackPort,
    ...(fallbackUsername ? { username: fallbackUsername } : {}),
    ...(fallbackPassword ? { password: fallbackPassword } : {}),
    ...(fallbackDb !== undefined ? { db: fallbackDb } : {}),
    ...(forceTls ? { tls: { servername: fallbackHost } } : {}),
  };
}
