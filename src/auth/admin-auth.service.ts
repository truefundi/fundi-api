import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { compare } from 'bcrypt';
import { createHmac, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RedisService } from '../redis/redis.service';
import { AdminLoginDto } from './dto/admin-login.dto';

// One message for every credential failure, so the endpoint cannot be used to
// discover which addresses belong to an administrator.
const INVALID_CREDENTIALS = 'Invalid email or password.';

// A real 12-round bcrypt hash of a random string nobody holds. Comparing against it
// costs the same as a genuine check, so an unknown address takes the same time to
// reject as a known one and cannot be detected by measuring the response.
const DECOY_PASSWORD_HASH = '$2b$12$2qJN/rJMpSD/MkUIPPmd7.zj8d0bd4WAYS9je88k20fe2lSyTvZ4O';

// Nest ships no 429 exception class, so throttled answers are raised directly.
// 429 rather than 403 because the caller is being slowed down, not refused.
function tooManyRequests(message: string) {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
}

// Shows which number a code went to without disclosing it, so an admin who no
// longer has that phone can tell before entering a code that can never arrive.
function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length <= 7) return phoneNumber;
  return `${phoneNumber.slice(0, 4)}${'*'.repeat(phoneNumber.length - 7)}${phoneNumber.slice(-3)}`;
}

// Counts one failed password against an address, on a sliding window. Keyed by a
// hash of the email so an address nobody registered still burns attempts and no
// plaintext address is written to Redis.
const COUNT_LOGIN_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
return count
`;

// Creates a challenge and supersedes any earlier one, so a second sign-in makes the
// first code worthless and only one code per admin is ever live. ARGV: key prefix,
// userId, code hash, absolute expiry (ms), key TTL (s), challengeId.
const CREATE_CHALLENGE_SCRIPT = `
local previous = redis.call('GET', KEYS[2])
if previous then redis.call('DEL', ARGV[1] .. previous) end
redis.call('HSET', KEYS[1], 'userId', ARGV[2], 'codeHash', ARGV[3], 'resendCount', '0', 'verificationTries', '0', 'expiresAt', ARGV[4])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
redis.call('SET', KEYS[2], ARGV[6], 'EX', tonumber(ARGV[5]))
return 1
`;

// Replaces the pending code while carrying the resend budget and failed-guess tally
// over, so resending cannot buy back a run of wrong guesses. -1 nothing pending,
// -2 budget spent.
const RESEND_CHALLENGE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local resendCount = tonumber(redis.call('HGET', KEYS[1], 'resendCount') or '0')
if resendCount >= tonumber(ARGV[2]) then return -2 end
local verificationTries = redis.call('HGET', KEYS[1], 'verificationTries') or '0'
redis.call('HSET', KEYS[1], 'codeHash', ARGV[1], 'resendCount', resendCount + 1, 'verificationTries', verificationTries, 'expiresAt', ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return resendCount + 1
`;

// Atomically checks and consumes a code. -1 nothing pending, -3 past its expiry,
// -2 the attempt limit was reached, 1 on success, 0 on a wrong guess. KEYS[2] is a
// per-account tally that outlives the challenge, so requesting a new code cannot
// clear it. ARGV: code hash, per-challenge limit, now (ms), per-account limit, window (s).
const VERIFY_CHALLENGE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  return -3
end
local verificationTries = tonumber(redis.call('HGET', KEYS[1], 'verificationTries') or '0')
if verificationTries >= tonumber(ARGV[2]) then return -2 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[4]) then return -2 end
if redis.call('HGET', KEYS[1], 'codeHash') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return 1
end
redis.call('HINCRBY', KEYS[1], 'verificationTries', 1)
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
return 0
`;

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly maxLoginAttempts: number;
  private readonly loginLockoutSeconds: number;
  private readonly twoFactorTtlSeconds: number;
  private readonly twoFactorMaxResends: number;
  private readonly twoFactorMaxTries: number;
  // Sliding window for the per-account wrong-code tally, matching the mobile OTP
  // behaviour so a slow trickle of guesses cannot accumulate forever.
  private readonly twoFactorAttemptWindowSeconds = 900;
  // Outlives the code by this much, so an expired code is still reported as expired
  // rather than looking like one that was never sent.
  private readonly twoFactorExpiryGraceSeconds = 120;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private smsService: SmsService,
    private redisService: RedisService,
  ) {
    this.maxLoginAttempts = this.configService.get<number>('adminAuth.maxLoginAttempts', 5);
    this.loginLockoutSeconds = this.configService.get<number>('adminAuth.loginLockoutSeconds', 900);
    this.twoFactorTtlSeconds = this.configService.get<number>('adminAuth.twoFactorTtlSeconds', 300);
    this.twoFactorMaxResends = this.configService.get<number>('adminAuth.twoFactorMaxResends', 3);
    this.twoFactorMaxTries = this.configService.get<number>('adminAuth.twoFactorMaxTries', 5);
  }

  // Step one: verifies the password and starts the second factor. Every failure
  // answers identically, so this endpoint cannot be used to enumerate administrators.
  async login(input: AdminLoginDto) {
    const failuresKey = this.loginFailuresKey(input.email);
    await this.assertNotLockedOut(failuresKey);

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        fullName: true,
        phoneNumber: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
      },
    });

    // An unknown address, an account with no password, a non-admin, a disabled
    // account and a wrong password all take the same comparison and raise the same
    // error. `usable` is false for the first four, so the real hash is never touched.
    const usable =
      !!user?.passwordHash && user.role === UserRole.ADMIN && user.status === 'ACTIVE';
    const matches = await compare(
      input.password,
      usable ? (user!.passwordHash as string) : DECOY_PASSWORD_HASH,
    );
    if (!usable || !matches) {
      await this.countLoginFailure(failuresKey);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.clearLoginFailures(failuresKey);
    const challengeId = await this.startTwoFactor(user!.id, user!.phoneNumber);
    return {
      message: `Verification code sent. It expires in ${this.twoFactorLifetimeMinutes()} minutes.`,
      maskedPhoneNumber: maskPhoneNumber(user!.phoneNumber),
      expiresInSeconds: this.twoFactorTtlSeconds,
      // Handed to the controller so it can set the challenge cookie. The controller
      // keeps it out of the response body.
      challengeId,
    };
  }

  // Replaces the pending code, keeping the resend budget for that same challenge.
  async resendTwoFactor(challengeId: string) {
    const challenge = await this.loadChallenge(challengeId);
    if (!challenge) {
      throw new BadRequestException('There is no pending verification. Sign in again.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      select: { id: true, phoneNumber: true },
    });
    if (!user) {
      throw new BadRequestException('There is no pending verification. Sign in again.');
    }

    const code = randomInt(100000, 1000000).toString();
    const resendCount = await this.runScript(
      RESEND_CHALLENGE_SCRIPT,
      [this.challengeKey(challengeId)],
      this.hashSecret(code),
      String(this.twoFactorMaxResends),
      String(this.twoFactorExpiresAt()),
      String(this.twoFactorKeyTtlSeconds()),
    );
    if (resendCount === -1) {
      throw new BadRequestException('There is no pending verification. Sign in again.');
    }
    if (resendCount === -2) {
      throw new BadRequestException(
        `The maximum of ${this.twoFactorMaxResends} code resends has been reached. Sign in again to request a new one.`,
      );
    }

    await this.deliverCode(challengeId, user.id, user.phoneNumber, code);
    return {
      message: `Verification code resent. ${this.twoFactorMaxResends - resendCount} resend(s) remain.`,
      maskedPhoneNumber: maskPhoneNumber(user.phoneNumber),
      expiresInSeconds: this.twoFactorTtlSeconds,
    };
  }

  // Step two: checks the code and, only now, creates the session.
  async verifyTwoFactor(challengeId: string, code: string) {
    const challenge = await this.loadChallenge(challengeId);
    if (!challenge) {
      throw new BadRequestException('There is no pending verification. Sign in again.');
    }

    const result = await this.runScript(
      VERIFY_CHALLENGE_SCRIPT,
      [this.challengeKey(challengeId), this.twoFactorTriesKey(challenge.userId)],
      this.hashSecret(code),
      String(this.twoFactorMaxTries),
      String(Date.now()),
      String(this.twoFactorMaxTries),
      String(this.twoFactorAttemptWindowSeconds),
    );
    if (result === -1) {
      throw new BadRequestException('There is no pending verification. Sign in again.');
    }
    if (result === -3) {
      throw new UnauthorizedException('The verification code has expired. Request a new one.');
    }
    if (result === -2) {
      throw tooManyRequests(
        'Too many incorrect verification codes. Request a new one in a few minutes.',
      );
    }
    if (result === 0) {
      throw new UnauthorizedException('The verification code is incorrect.');
    }

    return this.startSession(challenge.userId);
  }

  // Exchanges the refresh cookie for a fresh pair, rotating the stored session so the
  // presented token cannot be replayed.
  async refresh(refreshToken: string) {
    const session = await this.prisma.refreshToken.findUnique({
      where: { token: this.hashSecret(refreshToken) },
    });
    if (!session) {
      throw new UnauthorizedException('The session is invalid or has ended. Sign in again.');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('The session has expired. Sign in again.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      throw new UnauthorizedException('The account associated with this session no longer exists.');
    }
    this.ensureActive(user.status);
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('This account is not an administrator.');
    }

    const { sessionId, ...tokens } = await this.generateTokens(
      user.id,
      user.phoneNumber,
      user.role,
    );
    const rotatedHash = this.hashSecret(tokens.refreshToken);
    // Deleting and reinserting in one transaction keeps the old token single-use:
    // two concurrent refreshes race on the same row and only one delete can match.
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.deleteMany({
        where: { id: session.id, userId: user.id },
      });
      if (revoked.count === 0) {
        throw new UnauthorizedException('The session is invalid or has ended. Sign in again.');
      }
      await tx.refreshToken.create({
        data: {
          token: rotatedHash,
          sessionId,
          userId: user.id,
          expiresAt: this.refreshTokenExpiresAt(),
        },
      });
    });

    return this.sessionPayload(user, tokens);
  }

  // Ends the session. Deliberately does not fail when the token is unknown, so the
  // dashboard can always sign out: the cookies are cleared either way. Identified by
  // the refresh token alone rather than a user id, so signing out still works after
  // the access cookie has expired and no guard has run.
  async logout(refreshToken: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { token: this.hashSecret(refreshToken) },
      });
    }
    return { message: 'Signed out successfully.' };
  }

  // Returns the identity behind an authenticated admin session.
  async getAdminUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, role: true },
    });
    if (!user) {
      throw new UnauthorizedException('The account associated with this session no longer exists.');
    }
    // Picked one field at a time rather than spread, so that loosening the select
    // above can never start handing the password hash to a caller.
    return { id: user.id, fullName: user.fullName, email: user.email ?? '', role: user.role };
  }

  // Seconds the access token stays valid, so the client knows when to refresh.
  accessTokenSeconds(): number {
    return this.durationToSeconds(
      this.configService.get<string>('adminAuth.accessExpiresIn', '15m'),
    );
  }

  // Seconds the refresh session stays valid. Exposed so the cookie's own expiry is
  // set from the same number as the stored session row and the two cannot drift.
  refreshTokenSeconds(): number {
    return this.durationToSeconds(
      this.configService.get<string>('adminAuth.refreshExpiresIn', '12h'),
    );
  }

  // Seconds a pending challenge stays usable, used to age the challenge cookie so it
  // disappears at about the same moment the code does.
  twoFactorChallengeSeconds(): number {
    return this.twoFactorTtlSeconds;
  }

  // Writes the challenge state and dispatches the first code, returning the challenge
  // id so the caller can bind it to the cookie.
  private async startTwoFactor(userId: string, phoneNumber: string): Promise<string> {
    const challengeId = randomUUID();
    const code = randomInt(100000, 1000000).toString();
    await this.runScript(
      CREATE_CHALLENGE_SCRIPT,
      [this.challengeKey(challengeId), this.currentChallengeKey(userId)],
      'auth:admin:2fa:',
      userId,
      this.hashSecret(code),
      String(this.twoFactorExpiresAt()),
      String(this.twoFactorKeyTtlSeconds()),
      challengeId,
    );
    await this.deliverCode(challengeId, userId, phoneNumber, code);
    return challengeId;
  }

  // Sends the code and drops the challenge if delivery fails, so an admin is never
  // left waiting on a message that cannot arrive. They sign in again to retry.
  private async deliverCode(
    challengeId: string,
    userId: string,
    phoneNumber: string,
    code: string,
  ) {
    try {
      await this.smsService.sendOtp(phoneNumber, code);
    } catch (error) {
      await this.deleteKeys([this.challengeKey(challengeId), this.currentChallengeKey(userId)]);
      this.logger.error(
        `Two-factor SMS failed for admin ${userId}: ${this.errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'The verification code could not be sent. Try again shortly.',
      );
    }
  }

  // Issues the tokens and persists the session row the JWT strategy checks on every
  // request. Re-checks the account here because the challenge outlives a role change.
  private async startSession(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('The account associated with this verification no longer exists.');
    }
    this.ensureActive(user.status);
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('This account is not an administrator.');
    }
    const { sessionId, ...tokens } = await this.generateTokens(
      user.id,
      user.phoneNumber,
      user.role,
    );
    await this.prisma.refreshToken.create({
      data: {
        token: this.hashSecret(tokens.refreshToken),
        sessionId,
        userId: user.id,
        expiresAt: this.refreshTokenExpiresAt(),
      },
    });
    return this.sessionPayload(user, tokens);
  }

  // Assembles the service result. Tokens travel as cookies, so they are kept nested
  // under `tokens` for the controller to write and deliberately excluded from the
  // body it returns.
  private sessionPayload(
    user: { id: string; fullName: string; email: string | null; role: UserRole },
    tokens: { accessToken: string; refreshToken: string },
  ) {
    return {
      user: { id: user.id, fullName: user.fullName, email: user.email ?? '', role: user.role },
      expiresInSeconds: this.accessTokenSeconds(),
      tokens,
    };
  }

  // Signs the pair with the admin lifetimes rather than the mobile ones.
  private async generateTokens(userId: string, phoneNumber: string, role: string) {
    const sessionId = randomUUID();
    const payload = { sub: userId, phoneNumber, role, sid: sessionId };
    const accessSecret =
      this.configService.get<string>('jwt.accessSecret') || 'default_dev_access_secret_32chars';
    const refreshSecret =
      this.configService.get<string>('jwt.refreshSecret') || 'default_dev_refresh_secret_32chars';

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: accessSecret,
      expiresIn: this.configService.get<string>('adminAuth.accessExpiresIn', '15m') as `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`,
    });
    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: refreshSecret,
      expiresIn: this.configService.get<string>('adminAuth.refreshExpiresIn', '12h') as `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`,
    });

    return { accessToken, refreshToken, sessionId };
  }

  // Reads the owner of a pending challenge, or null when it is gone or expired.
  private async loadChallenge(challengeId: string): Promise<{ userId: string } | null> {
    if (!challengeId) return null;
    const client = this.redisService.getClient();
    const stored = await this.readRedis('Reading a two-factor challenge', () =>
      client.hgetall(this.challengeKey(challengeId)),
    );
    if (!stored?.userId) return null;
    return { userId: stored.userId };
  }

  // Refuses a locked address before spending any bcrypt time on it.
  private async assertNotLockedOut(failuresKey: string) {
    const client = this.redisService.getClient();
    const attempts = Number(
      (await this.readRedis('Reading the sign-in attempt counter', () =>
        client.get(failuresKey),
      )) ?? 0,
    );
    if (attempts < this.maxLoginAttempts) return;
    const ttl = await this.readRedis('Reading the lockout window', () => client.ttl(failuresKey));
    throw tooManyRequests(
      `Too many failed sign-in attempts. Try again in ${Math.max(1, Math.ceil(ttl / 60))} minute(s).`,
    );
  }

  private async countLoginFailure(failuresKey: string) {
    await this.runScript(
      COUNT_LOGIN_FAILURE_SCRIPT,
      [failuresKey],
      String(this.loginLockoutSeconds),
    );
  }

  private async clearLoginFailures(failuresKey: string) {
    await this.deleteKeys([failuresKey]);
  }

  // Keeps pending challenge records in a namespaced key.
  private challengeKey(challengeId: string) {
    return `auth:admin:2fa:${challengeId}`;
  }

  // Points at the one live challenge per admin, so a new sign-in can retire it.
  private currentChallengeKey(userId: string) {
    return `auth:admin:2fa:current:${userId}`;
  }

  // Holds the per-account wrong-code tally, separate from the challenge so a new
  // code cannot reset it.
  private twoFactorTriesKey(userId: string) {
    return `auth:admin:2fa:tries:${userId}`;
  }

  // Keyed by a digest rather than the address, so an unregistered email is still
  // rate-limited and no plaintext email lands in Redis.
  private loginFailuresKey(email: string) {
    return `auth:admin:login:tries:${this.hashSecret(email)}`;
  }

  private twoFactorExpiresAt(): number {
    return Date.now() + this.twoFactorTtlSeconds * 1000;
  }

  private twoFactorLifetimeMinutes(): number {
    return Math.round(this.twoFactorTtlSeconds / 60);
  }

  // The challenge key outlives the code by a grace period so an expired code is
  // reported as expired instead of looking like one that was never sent.
  private twoFactorKeyTtlSeconds(): number {
    return this.twoFactorTtlSeconds + this.twoFactorExpiryGraceSeconds;
  }

  // Expiry stored on the refresh-token row, kept in step with adminAuth.refreshExpiresIn.
  private refreshTokenExpiresAt(): Date {
    return new Date(Date.now() + this.refreshTokenSeconds() * 1000);
  }

  // Converts a JWT duration such as 15m or 12h into seconds.
  private durationToSeconds(value: string): number {
    const match = /^(\d+)\s*(s|m|h|d|w|y)?$/i.exec(String(value).trim());
    if (!match) return 900;
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 };
    return Number(match[1]) * units[(match[2] || 's').toLowerCase()];
  }

  // Hashes codes and refresh tokens before storing them.
  private hashSecret(value: string) {
    const secret =
      this.configService.get<string>('jwt.tokenHashSecret') ||
      this.configService.get<string>('jwt.refreshSecret') ||
      'development_token_hash_secret_change_before_production';
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  // Runs one Redis read and translates an outage into a service error, so a Redis
  // failure is never mistaken for a rejected credential or a missing challenge. The
  // 429 and 400 answers are raised outside this helper so they are not swallowed.
  private async readRedis<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      this.logger.error(`${operation} failed: ${this.errorMessage(error)}`);
      throw new ServiceUnavailableException(
        'The verification service is unavailable. Try again shortly.',
      );
    }
  }

  // Runs an atomic Redis operation and translates outages to a service error.
  private async runScript(script: string, keys: string[], ...args: string[]): Promise<number> {
    try {
      const result = await this.redisService.getClient().eval(script, keys.length, ...keys, ...args);
      return Number(result);
    } catch (error) {
      this.logger.error(`Admin auth Redis operation failed: ${this.errorMessage(error)}`);
      throw new ServiceUnavailableException(
        'The verification service is unavailable. Try again shortly.',
      );
    }
  }

  private async deleteKeys(keys: string[]) {
    try {
      await this.redisService.getClient().del(...keys);
    } catch (error) {
      this.logger.error(`Could not clear admin auth keys: ${this.errorMessage(error)}`);
    }
  }

  // Ensures only active administrator accounts can hold or refresh a session.
  private ensureActive(status: string) {
    if (status !== 'ACTIVE') {
      throw new ForbiddenException(
        'This account is not active. Please contact the administrator.',
      );
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}