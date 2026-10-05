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
import { authenticator } from 'otplib';
import { compare } from 'bcrypt';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TotpCryptoService } from './totp-crypto.service';
import { AdminLoginDto } from './dto/admin-login.dto';

// One message for every credential failure, so the endpoint cannot be used to
// discover which addresses belong to an administrator.
const INVALID_CREDENTIALS = 'Invalid email or password.';

// One message for every missing or spent challenge, so it cannot be used to tell a
// stale sign-in from one that never existed.
const NO_PENDING_VERIFICATION = 'There is no pending verification. Sign in again.';

// A real 12-round bcrypt hash of a random string nobody holds. Comparing against it
// costs the same as a genuine check, so an unknown address takes the same time to
// reject as a known one and cannot be detected by measuring the response.
const DECOY_PASSWORD_HASH = '$2b$12$2qJN/rJMpSD/MkUIPPmd7.zj8d0bd4WAYS9je88k20fe2lSyTvZ4O';

// Nest ships no 429 exception class, so throttled answers are raised directly.
// 429 rather than 403 because the caller is being slowed down, not refused.
function tooManyRequests(message: string) {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
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
// first worthless and only one challenge per admin is ever live.
//
// In 'enroll' mode the shared secret is held here in the clear for the length of the
// enrolment window. It is written to the database only once a first code is accepted,
// so an enrolment that is abandoned leaves nothing behind to clean up.
//
// ARGV: key prefix, userId, mode, secret, absolute expiry (ms), key TTL (s), challengeId.
const CREATE_CHALLENGE_SCRIPT = `
local previous = redis.call('GET', KEYS[2])
if previous then redis.call('DEL', ARGV[1] .. previous) end
redis.call('HSET', KEYS[1], 'userId', ARGV[2], 'mode', ARGV[3], 'secret', ARGV[4], 'expiresAt', ARGV[5])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[6]))
redis.call('SET', KEYS[2], ARGV[7], 'EX', tonumber(ARGV[6]))
return 1
`;

// Claims exactly one guess and counts it, before the code itself is checked. The
// check has to happen outside Redis because verifying a TOTP means computing an
// HMAC, so this is what keeps the attempt budget honest: the counters move in the
// same atomic step that authorises the attempt, so concurrent requests cannot both
// slip past the limit. KEYS[2] is a per-account tally that outlives the challenge, so
// signing in again cannot clear it.
//
// -1 nothing pending, -3 past its expiry, -2 the attempt limit was reached, 1 allowed.
const CLAIM_ATTEMPT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return -3
end
if tonumber(redis.call('HGET', KEYS[1], 'verificationTries') or '0') >= tonumber(ARGV[1]) then return -2 end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[3]) then return -2 end
redis.call('HINCRBY', KEYS[1], 'verificationTries', 1)
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
return 1
`;

// Retires the challenge and the attempt tally in one step, returning how many keys
// were actually removed. A caller that loses the race to a concurrent request sees 0
// and is refused, which is what makes a single valid code mint at most one session.
const CONSUME_CHALLENGE_SCRIPT = `
local removed = redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[2])
redis.call('DEL', KEYS[3])
return removed
`;

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly maxLoginAttempts: number;
  private readonly loginLockoutSeconds: number;
  private readonly twoFactorPendingSeconds: number;
  private readonly twoFactorMaxTries: number;
  private readonly totpIssuer: string;
  private readonly totpWindow: number;
  // Sliding window for the per-account wrong-code tally, matching the mobile OTP
  // behaviour so a slow trickle of guesses cannot accumulate forever.
  private readonly twoFactorAttemptWindowSeconds = 900;
  // Seconds in one TOTP step. Fixed by the standard, not configurable.
  private readonly totpStepSeconds = 30;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private redisService: RedisService,
    private totpCrypto: TotpCryptoService,
  ) {
    this.maxLoginAttempts = this.configService.get<number>('adminAuth.maxLoginAttempts', 5);
    this.loginLockoutSeconds = this.configService.get<number>('adminAuth.loginLockoutSeconds', 900);
    this.twoFactorPendingSeconds = this.configService.get<number>(
      'adminAuth.twoFactorPendingSeconds',
      300,
    );
    this.twoFactorMaxTries = this.configService.get<number>('adminAuth.twoFactorMaxTries', 5);
    this.totpIssuer = this.configService.get<string>('adminAuth.totpIssuer', 'Fundi');
    this.totpWindow = this.configService.get<number>('adminAuth.totpWindow', 1);
  }

  // Step one: verifies the password, then either asks for a code or starts a first
  // enrolment. Every credential failure answers identically, so this endpoint cannot
  // be used to enumerate administrators.
  async login(input: AdminLoginDto) {
    const failuresKey = this.loginFailuresKey(input.email);
    await this.assertNotLockedOut(failuresKey);

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
        passwordHash: true,
        totpEnabledAt: true,
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

    // Already enrolled: the secret is on the account, so the only thing left is the
    // code the authenticator is showing. Nothing is generated and nothing is sent.
    if (user!.totpEnabledAt) {
      const challengeId = await this.startChallenge(user!.id, 'verify', '');
      return {
        message: 'Enter the 6-digit code from your authenticator app.',
        enrollmentRequired: false,
        expiresInSeconds: this.twoFactorChallengeSeconds(),
        challengeId,
      };
    }

    // First time. A secret is generated per sign-in rather than per account and is
    // only persisted once a code proves the app can produce it, so re-running this
    // simply replaces an unconfirmed enrolment instead of orphaning one.
    const secret = authenticator.generateSecret(20);
    const challengeId = await this.startChallenge(user!.id, 'enroll', secret);
    return {
      message:
        'Scan this with your authenticator app, then enter the 6-digit code it shows. ' +
        'If you cannot scan, enter the secret by hand.',
      enrollmentRequired: true,
      expiresInSeconds: this.twoFactorChallengeSeconds(),
      otpauthUri: authenticator.keyuri(user!.email ?? user!.id, this.totpIssuer, secret),
      // Also returned so the dashboard can offer manual entry. Shown only while the
      // challenge is open, and never stored in the clear.
      secret,
      challengeId,
    };
  }

  // Step two: checks the code and, only now, creates the session. A correct code in
  // enrolment mode also commits the secret, which is what makes the factor usable on
  // every later sign-in.
  async verifyTwoFactor(challengeId: string, code: string) {
    const challenge = await this.loadChallenge(challengeId);
    if (!challenge) {
      throw new BadRequestException(NO_PENDING_VERIFICATION);
    }

    const claim = await this.runScript(
      CLAIM_ATTEMPT_SCRIPT,
      [this.challengeKey(challengeId), this.twoFactorTriesKey(challenge.userId)],
      String(this.twoFactorMaxTries),
      String(Date.now()),
      String(this.twoFactorMaxTries),
      String(this.twoFactorAttemptWindowSeconds),
    );
    if (claim === -1) {
      throw new BadRequestException(NO_PENDING_VERIFICATION);
    }
    if (claim === -3) {
      throw new UnauthorizedException('The sign-in window has expired. Sign in again.');
    }
    if (claim === -2) {
      throw tooManyRequests(
        'Too many incorrect verification codes. Wait a few minutes and sign in again.',
      );
    }

    const secret =
      challenge.mode === 'enroll' ? challenge.secret : await this.readStoredSecret(challenge.userId);
    if (!this.codeMatches(code, secret)) {
      throw new UnauthorizedException('The verification code is incorrect.');
    }

    if (challenge.mode === 'enroll') {
      await this.commitSecret(challenge.userId, secret);
    }

    const consumed = await this.runScript(
      CONSUME_CHALLENGE_SCRIPT,
      [
        this.challengeKey(challengeId),
        this.currentChallengeKey(challenge.userId),
        this.twoFactorTriesKey(challenge.userId),
      ],
    );
    // Lost the race to a concurrent request holding the same code. Refused rather
    // than issued twice, so one code is worth at most one session.
    if (consumed === 0) {
      throw new BadRequestException(NO_PENDING_VERIFICATION);
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

    const { sessionId, ...tokens } = await this.generateTokens(user.id, user.role);
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
    // above can never start handing the password hash or the TOTP secret to a caller.
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

  // Seconds a password-verified sign-in stays open waiting for a code. Used to age
  // the challenge cookie so it disappears at about the same moment the window does.
  twoFactorChallengeSeconds(): number {
    return this.twoFactorPendingSeconds;
  }

  // Writes the challenge state and returns its id so the caller can bind it to the
  // cookie. In 'enroll' mode the secret rides along and is not yet on the account.
  private async startChallenge(userId: string, mode: string, secret: string): Promise<string> {
    const challengeId = randomUUID();
    await this.runScript(
      CREATE_CHALLENGE_SCRIPT,
      [this.challengeKey(challengeId), this.currentChallengeKey(userId)],
      'auth:admin:2fa:',
      userId,
      mode,
      secret,
      String(Date.now() + this.twoFactorPendingSeconds * 1000),
      String(this.twoFactorKeyTtlSeconds()),
      challengeId,
    );
    return challengeId;
  }

  // Reads the encrypted secret off the account. A missing value means the enrolment
  // was cleared, which is not something a caller can be told about quietly.
  private async readStoredSecret(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true },
    });
    if (!user?.totpSecret) {
      throw new BadRequestException(
        'This account has no authenticator enrolled. Sign in again to set one up.',
      );
    }
    return this.totpCrypto.decrypt(user.totpSecret);
  }

  // Persists the secret once the admin has proved their authenticator can produce a
  // matching code, and marks the factor usable from this moment on.
  private async commitSecret(userId: string, secret: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: this.totpCrypto.encrypt(secret), totpEnabledAt: new Date() },
    });
  }

  // Compares a submitted code against every step in the tolerance window, in constant
  // time. otplib's own check uses `===`, so it is not used here: a short, repeatedly
  // submitted value is exactly the case where an early-exit compare leaks how many
  // leading digits were right.
  private codeMatches(code: string, secret: string): boolean {
    if (!/^\d{6}$/.test(code) || !secret) return false;
    const now = Date.now();
    const submitted = Buffer.from(code, 'utf8');
    // otplib derives its expected code from the epoch held on the instance, and
    // `generate` takes no epoch argument. A fresh instance per candidate is used
    // rather than reassigning the shared singleton's options, which would let one
    // request verify a code against another request's clock.
    const options = authenticator.allOptions();
    let matched = 0;
    // Every candidate is compared, with no short-circuit, so the work done is the same
    // whether the code was right or wrong.
    for (let step = -this.totpWindow; step <= this.totpWindow; step++) {
      const expected = Buffer.from(
        authenticator
          .create({ ...options, epoch: now + step * this.totpStepSeconds * 1000 })
          .generate(secret),
        'utf8',
      );
      if (expected.length === submitted.length && timingSafeEqual(submitted, expected)) {
        matched = 1;
      }
    }
    return matched === 1;
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
    const { sessionId, ...tokens } = await this.generateTokens(user.id, user.role);
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

  // Signs the pair with the admin lifetimes rather than the mobile ones. The claim
  // carries no phone number, since the admin factor is no longer tied to one.
  private async generateTokens(userId: string, role: string) {
    const sessionId = randomUUID();
    const payload = { sub: userId, role, sid: sessionId };
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

  // Reads the owner and mode of a pending challenge, or null when it is gone.
  private async loadChallenge(
    challengeId: string,
  ): Promise<{ userId: string; mode: string; secret: string } | null> {
    if (!challengeId) return null;
    const client = this.redisService.getClient();
    const stored = await this.readRedis('Reading a two-factor challenge', () =>
      client.hgetall(this.challengeKey(challengeId)),
    );
    if (!stored?.userId) return null;
    return { userId: stored.userId, mode: stored.mode, secret: stored.secret ?? '' };
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

  // Holds the per-account wrong-code tally, separate from the challenge so signing in
  // again cannot reset it.
  private twoFactorTriesKey(userId: string) {
    return `auth:admin:2fa:tries:${userId}`;
  }

  // Keyed by a digest rather than the address, so an unregistered email is still
  // rate-limited and no plaintext email lands in Redis.
  private loginFailuresKey(email: string) {
    return `auth:admin:login:tries:${this.hashSecret(email)}`;
  }

  // The challenge key outlives its window slightly, so an expired sign-in is still
  // reported as expired rather than looking like one that never happened.
  private twoFactorKeyTtlSeconds(): number {
    return this.twoFactorPendingSeconds + 120;
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