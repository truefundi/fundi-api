import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { RedisService } from '../../redis/redis.service';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Atomic hit + TTL + block-window evaluation in Redis (milliseconds in, seconds out).
const THROTTLE_INCREMENT_SCRIPT = `
local hitKey = KEYS[1]
local blockKey = KEYS[2]
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDurationMs = tonumber(ARGV[3])

local blockTtlMs = redis.call('PTTL', blockKey)
if blockTtlMs > 0 then
  local hits = tonumber(redis.call('GET', hitKey) or limit)
  local expireMs = redis.call('PTTL', hitKey)
  if expireMs < 0 then expireMs = blockTtlMs end
  return { hits + 1, expireMs, 1, blockTtlMs }
end

local hits = redis.call('INCR', hitKey)
if hits == 1 then
  redis.call('PEXPIRE', hitKey, ttlMs)
end
local expireMs = redis.call('PTTL', hitKey)
if expireMs < 0 then
  redis.call('PEXPIRE', hitKey, ttlMs)
  expireMs = ttlMs
end

if hits > limit then
  if blockDurationMs > 0 then
    redis.call('SET', blockKey, '1', 'PX', blockDurationMs)
    return { hits, expireMs, 1, blockDurationMs }
  end
  return { hits, expireMs, 1, expireMs }
end

return { hits, expireMs, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `fundi:throttle:${throttlerName}:${key}:hits`;
    const blockKey = `fundi:throttle:${throttlerName}:${key}:block`;
    const safeTtlMs = Math.max(1, Math.ceil(ttl));
    const safeBlockMs = Math.max(0, Math.ceil(blockDuration));

    try {
      const client = this.redis.getClient();
      if (client.status === 'wait') {
        await client.connect();
      }
      const raw = (await client.eval(
        THROTTLE_INCREMENT_SCRIPT,
        2,
        hitKey,
        blockKey,
        String(safeTtlMs),
        String(limit),
        String(safeBlockMs),
      )) as [number, number, number, number];

      return {
        totalHits: Number(raw[0]),
        timeToExpire: Math.max(1, Math.ceil(Number(raw[1]) / 1000)),
        isBlocked: Number(raw[2]) === 1,
        timeToBlockExpire:
          Number(raw[3]) > 0 ? Math.ceil(Number(raw[3]) / 1000) : 0,
      };
    } catch (error) {
      this.logger.warn(
        `Redis throttler fallback (allowing request): ${(error as Error).message}`,
      );
      return {
        totalHits: 1,
        timeToExpire: Math.max(1, Math.ceil(safeTtlMs / 1000)),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}

@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const expressReq = req as unknown as Request;
    if (typeof expressReq.ip === 'string' && expressReq.ip.length > 0) {
      return expressReq.ip;
    }
    return expressReq.socket?.remoteAddress || 'unknown';
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    return super.canActivate(context);
  }
}
