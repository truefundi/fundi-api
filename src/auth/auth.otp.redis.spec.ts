import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AuthService } from './auth.service';

// Exercises the real Lua scripts against a live Redis. The sibling mocked suite
// stubs eval() and therefore never runs a script, so an argument that no longer
// lines up would go unnoticed there.
//
// Skips itself when Redis is unreachable, so this stays safe to include in
// `pnpm test` on machines and CI runners without a Redis instance. Skipped cases
// are reported as skipped rather than passed, so a green run always means the
// scripts really executed.
const HOST = process.env.REDIS_HOST ?? 'localhost';
const PORT = Number(process.env.REDIS_PORT ?? 6379);
const SECRET = 'development_token_hash_secret_change_before_production';

// Whether a Redis is accepting connections.
//
// This is resolved at module scope on purpose. Jest collects every `it()` before
// any hook runs, so a flag assigned in beforeAll is still false at the point the
// skip decision below is made and the whole suite would skip even when Redis is
// up. The check is therefore a synchronous TCP connect that blocks this module's
// load for at most a second, which is cheap because it happens once per file.
const isRedisReachable = (): boolean => {
  const { execFileSync } = require('child_process') as typeof import('child_process');
  const host = HOST === 'localhost' ? '127.0.0.1' : HOST;

  // A separate process does the TCP connect and reports the outcome on stdout.
  // The connect has to happen in another process because this one is blocked
  // while waiting: a synchronous socket probe here could never receive its own
  // callback, since the thread that would deliver it is the blocked one.
  const probe = `
    const net = require('net');
    const socket = new net.Socket();
    socket.setTimeout(700);
    const done = (result) => { console.log(result); socket.destroy(); process.exit(result === 'OK' ? 0 : 1); };
    socket.once('connect', () => done('OK'));
    socket.once('error', () => done('NO'));
    socket.once('timeout', () => done('NO'));
    socket.connect(${PORT}, ${JSON.stringify(host)});
  `;

  try {
    const output = execFileSync(process.execPath, ['-e', probe], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim() === 'OK';
  } catch {
    return false;
  }
};

const redisAvailable = isRedisReachable();

if (!redisAvailable) {
  console.warn(`[auth.otp.redis.spec] skipped: no Redis reachable at ${HOST}:${PORT}`);
}

const itIfRedis = redisAvailable ? it : it.skip;

describe('AuthService OTP scripts against Redis', () => {
  const activeUser = {
    id: 'otp-script-user',
    fullName: 'Amina Example',
    phoneNumber: '+250788123456',
    email: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  };

  let client: Redis;
  let sent: Array<{ phoneNumber: string; code: string }>;
  let service: AuthService;
  let key: string;
  let triesKey: string;

  // The code most recently handed to the SMS boundary.
  const lastCode = () => sent[sent.length - 1].code;

  // Any code the user could not plausibly have been sent.
  const wrongCode = () => (lastCode() === '000000' ? '111111' : '000000');

  beforeEach(async () => {
    client = new Redis({ host: HOST, port: PORT });
    sent = [];
    key = `auth:otp:${activeUser.id}`;
    triesKey = `auth:otp:tries:${activeUser.id}`;

    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(activeUser) },
      refreshToken: { create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const sms = {
      sendOtp: jest.fn().mockImplementation(async (phoneNumber: string, code: string) => {
        sent.push({ phoneNumber, code });
      }),
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('token') };
    const config = {
      get: jest.fn((name: string, fallback: unknown) => {
        if (name === 'jwt.tokenHashSecret') return SECRET;
        if (name === 'redis.host') return HOST;
        if (name === 'redis.port') return PORT;
        return fallback;
      }),
    };

    service = new AuthService(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      prisma as never,
      sms as never,
      { getClient: () => client } as never,
    );

    await client.del(key, triesKey);
  });

  afterEach(async () => {
    if (!client) return;
    await client.del(key, triesKey);
    // disconnect() releases the socket without waiting on Redis, which keeps
    // Jest from having to force-exit the worker.
    client.disconnect();
  });

  describe('issuing a code', () => {
    itIfRedis('stores a hash and never the code itself', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const stored = await client.hgetall(key);
      expect(sent).toHaveLength(1);
      expect(stored.codeHash).toBeTruthy();
      expect(JSON.stringify(stored)).not.toContain(lastCode());
      expect(stored.expiresAt).toBeTruthy();
    });

    itIfRedis('sends a six-digit code to the phone number on file', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      expect(sent[0].phoneNumber).toBe(activeUser.phoneNumber);
      expect(lastCode()).toMatch(/^\d{6}$/);
    });

    itIfRedis('keeps the key alive past the code lifetime', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      // 300s of validity plus the 120s grace period that keeps expiry reportable.
      const ttl = await client.ttl(key);
      expect(ttl).toBeGreaterThan(300);
      expect(ttl).toBeLessThanOrEqual(420);
    });

    itIfRedis('stamps the hash with the configured five-minute expiry', async () => {
      const before = Date.now();
      await service.requestLoginOtp(activeUser.phoneNumber);
      const stored = await client.hgetall(key);
      const seconds = (Number(stored.expiresAt) - before) / 1000;
      expect(seconds).toBeGreaterThan(295);
      expect(seconds).toBeLessThanOrEqual(300);
    });

    itIfRedis('tells the caller how long the code stays usable', async () => {
      await expect(service.requestLoginOtp(activeUser.phoneNumber)).resolves.toMatchObject({
        message: 'OTP generated. It expires in 5 minutes.',
      });
    });

    itIfRedis('starts the attempt and resend counters at zero', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const stored = await client.hgetall(key);
      expect(stored.verificationTries).toBe('0');
      expect(stored.resendCount).toBe('0');
    });
  });

  describe('verifying a code', () => {
    itIfRedis('accepts the correct code and consumes it', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      await expect(service.verifyOtp(activeUser.phoneNumber, lastCode())).resolves.toMatchObject({
        user: { phoneNumber: activeUser.phoneNumber },
      });
      expect(await client.exists(key)).toBe(0);
    });

    itIfRedis('refuses to reuse a consumed code', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const code = lastCode();
      await service.verifyOtp(activeUser.phoneNumber, code);
      await expect(service.verifyOtp(activeUser.phoneNumber, code)).rejects.toThrow(
        'No OTP is pending. Request a new login OTP.',
      );
    });

    itIfRedis('rejects an incorrect code as unauthorized', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      await expect(service.verifyOtp(activeUser.phoneNumber, wrongCode())).rejects.toThrow('The OTP is incorrect.');
      expect(await client.hget(key, 'verificationTries')).toBe('1');
    });

    itIfRedis('reports a missing code as a bad request', async () => {
      await expect(service.verifyOtp(activeUser.phoneNumber, '123456')).rejects.toThrow(
        'No OTP is pending. Request a new login OTP.',
      );
    });

    itIfRedis('reports an expired code as unauthorized, not as a bad request', async () => {
      const shortLived = Object.create(service) as AuthService;
      // readonly is erased at runtime; shortening the window keeps the test quick.
      (shortLived as unknown as { otpTtlSeconds: number }).otpTtlSeconds = 1;
      await shortLived.requestLoginOtp(activeUser.phoneNumber);
      const code = lastCode();
      await new Promise((resolve) => setTimeout(resolve, 1300));
      await expect(shortLived.verifyOtp(activeUser.phoneNumber, code)).rejects.toThrow(
        'The OTP has expired. Request a new login OTP.',
      );
    });
  });

  describe('limiting repeated wrong guesses', () => {
    itIfRedis('forbids further attempts once the limit is reached', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const wrong = wrongCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(service.verifyOtp(activeUser.phoneNumber, wrong)).rejects.toThrow('The OTP is incorrect.');
      }
      await expect(service.verifyOtp(activeUser.phoneNumber, wrong)).rejects.toThrow(
        'Too many incorrect OTP attempts. Wait a few minutes before trying again.',
      );
    });

    itIfRedis('still rejects the right code once the limit is reached', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const code = lastCode();
      const wrong = wrongCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await service.verifyOtp(activeUser.phoneNumber, wrong).catch(() => undefined);
      }
      await expect(service.verifyOtp(activeUser.phoneNumber, code)).rejects.toThrow(
        'Too many incorrect OTP attempts. Wait a few minutes before trying again.',
      );
    });

    // The tally must belong to the account, not to whichever code is pending.
    itIfRedis('does not let a freshly requested code buy back guesses', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const wrong = wrongCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await service.verifyOtp(activeUser.phoneNumber, wrong).catch(() => undefined);
      }
      // A brand new OTP resets the per-code counter...
      await service.requestLoginOtp(activeUser.phoneNumber);
      expect(Number(await client.hget(key, 'verificationTries'))).toBe(0);
      // ...but the account-scoped tally must still refuse the guess.
      await expect(service.verifyOtp(activeUser.phoneNumber, wrongCode())).rejects.toThrow(
        'Too many incorrect OTP attempts.',
      );
    });

    itIfRedis('refuses the correct code on a fresh request once the account is locked', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const wrong = wrongCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await service.verifyOtp(activeUser.phoneNumber, wrong).catch(() => undefined);
      }
      await service.requestLoginOtp(activeUser.phoneNumber);
      const fresh = lastCode();
      await expect(service.verifyOtp(activeUser.phoneNumber, fresh)).rejects.toThrow(
        'Too many incorrect OTP attempts.',
      );
    });

    itIfRedis('clears the account tally once the right code arrives', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const code = lastCode();
      const wrong = wrongCode();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await service.verifyOtp(activeUser.phoneNumber, wrong).catch(() => undefined);
      }
      expect(Number(await client.get(triesKey))).toBe(3);
      await service.verifyOtp(activeUser.phoneNumber, code);
      expect(await client.get(triesKey)).toBeNull();
    });

    itIfRedis('keeps the account tally separate per account', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const wrong = wrongCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await service.verifyOtp(activeUser.phoneNumber, wrong).catch(() => undefined);
      }
      await expect(client.get(`auth:otp:tries:somebody-else`)).resolves.toBeNull();
      expect(Number(await client.get(triesKey))).toBe(5);
    });
  });

  describe('resending a code', () => {
    itIfRedis('replaces the code and invalidates the previous one', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const original = lastCode();
      await service.resendOtp(activeUser.phoneNumber);
      expect(lastCode()).not.toBe(original);
      await expect(service.verifyOtp(activeUser.phoneNumber, original)).rejects.toThrow('The OTP is incorrect.');
    });

    itIfRedis('reports the remaining resends', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      await expect(service.resendOtp(activeUser.phoneNumber)).resolves.toMatchObject({
        message: expect.stringContaining('2 resend'),
      });
    });

    itIfRedis('allows at most three resends', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      await service.resendOtp(activeUser.phoneNumber);
      await service.resendOtp(activeUser.phoneNumber);
      await expect(service.resendOtp(activeUser.phoneNumber)).resolves.toMatchObject({
        message: expect.stringContaining('0 resend'),
      });
      await expect(service.resendOtp(activeUser.phoneNumber)).rejects.toThrow(
        'The maximum of three OTP resends has been reached.',
      );
    });

    itIfRedis('sends no further code once the resend limit is hit', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      await service.resendOtp(activeUser.phoneNumber);
      await service.resendOtp(activeUser.phoneNumber);
      await service.resendOtp(activeUser.phoneNumber);
      const before = sent.length;
      await expect(service.resendOtp(activeUser.phoneNumber)).rejects.toThrow();
      expect(sent).toHaveLength(before);
    });

    itIfRedis('keeps the failed-attempt count so resending cannot reset it', async () => {
      await service.requestLoginOtp(activeUser.phoneNumber);
      const wrong = wrongCode();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await service.verifyOtp(activeUser.phoneNumber, wrong).catch(() => undefined);
      }
      await service.resendOtp(activeUser.phoneNumber);
      expect(await client.hget(key, 'verificationTries')).toBe('3');
    });

    itIfRedis('rejects a resend when nothing is pending', async () => {
      await expect(service.resendOtp(activeUser.phoneNumber)).rejects.toThrow(
        'There is no pending OTP. Request a login OTP first.',
      );
    });
  });

  describe('when Redis itself fails', () => {
    itIfRedis('surfaces a service-unavailable error', async () => {
      const broken = new AuthService(
        { signAsync: jest.fn() } as unknown as JwtService,
        { get: jest.fn((_name: string, fallback: unknown) => fallback) } as unknown as ConfigService,
        { user: { findUnique: jest.fn().mockResolvedValue(activeUser) } } as never,
        { sendOtp: jest.fn() } as never,
        {
          getClient: () => {
            throw new Error('connection refused');
          },
        } as never,
      );
      await expect(broken.requestLoginOtp(activeUser.phoneNumber)).rejects.toThrow(
        'OTP service is unavailable. Please try again later.',
      );
    });
  });
});