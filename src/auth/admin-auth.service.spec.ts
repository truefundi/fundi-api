import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { hashSync } from 'bcrypt';
import { authenticator } from 'otplib';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AdminAuthService } from './admin-auth.service';
import { TotpCryptoService } from './totp-crypto.service';

// The password step is exercised against a real bcrypt hash rather than a mock, so the
// decoy comparison that hides whether an address exists is genuinely covered. Four
// rounds keeps each comparison in the low milliseconds; production uses twelve.
const PASSWORD = 'Fundi#Admin2026';
const PASSWORD_HASH = hashSync(PASSWORD, 4);

// A fixed 160-bit base32 secret, standing in for one that was generated at enrolment.
// Fixed so a submitted code can be computed from it rather than mocked.
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

// Seconds in one TOTP step, fixed by the standard.
const STEP_MS = 30_000;

// Codes are computed with the same library the service uses, so a passing test means
// a real authenticator would produce a matching code rather than that a mock agreed.
const codeAt = (offsetSteps: number) =>
  authenticator.create({ ...authenticator.allOptions(), epoch: Date.now() + offsetSteps * STEP_MS }).generate(
    TOTP_SECRET,
  );

const currentCode = () => codeAt(0);

// A code the window cannot accept. Derived from the live one by walking forward until
// it lies outside the window, so it cannot collide with a real code by luck.
const rejectedCode = () => {
  const withinWindow = authenticator.create({ ...authenticator.allOptions(), window: 1 });
  let code = currentCode();
  do {
    code = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  } while (withinWindow.check(code, TOTP_SECRET));
  return code;
};

// Verifies the admin credential rules, the authenticator state machine, and session
// handling without any external service.
describe('AdminAuthService', () => {
  // An account with no authenticator yet: the first sign-in has to enrol one.
  const adminUser = {
    id: 'admin-1',
    fullName: 'Alice Mukamana',
    phoneNumber: '+250788123456',
    email: 'admin@fundi.rw',
    role: UserRole.ADMIN,
    status: 'ACTIVE',
    passwordHash: PASSWORD_HASH,
    totpSecret: null,
    totpEnabledAt: null,
  };

  // The same account once a first code has been accepted.
  const enrolledAdmin = {
    ...adminUser,
    totpSecret: 'encrypted-blob',
    totpEnabledAt: new Date('2026-01-15T08:00:00.000Z'),
  };

  // Builds an isolated service with mocked database, crypto, JWT, Redis and settings.
  const createService = (overrides: Record<string, unknown> = {}) => {
    const redisClient = {
      get: jest.fn().mockResolvedValue(null),
      ttl: jest.fn().mockResolvedValue(600),
      hgetall: jest.fn().mockResolvedValue({ userId: enrolledAdmin.id, mode: 'verify', secret: '' }),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
    };
    const tx = {
      refreshToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(enrolledAdmin),
        update: jest.fn().mockResolvedValue({}),
      },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: enrolledAdmin.id,
          token: 'stored-hash',
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      },
      $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    const totpCrypto = {
      encrypt: jest.fn().mockReturnValue('encrypted-blob'),
      decrypt: jest.fn().mockReturnValue(TOTP_SECRET),
    };
    const jwt = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
    };
    const config = {
      get: jest.fn((key: string, fallback: unknown) =>
        key in overrides ? overrides[key] : fallback,
      ),
    };
    const service = new AdminAuthService(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      { getClient: () => redisClient } as unknown as RedisService,
      totpCrypto as unknown as TotpCryptoService,
    );
    return { service, prisma, totpCrypto, jwt, redisClient, tx };
  };

  // Captures a rejection so both its type and its HTTP status can be asserted.
  const captureError = async (promise: Promise<unknown>) => {
    try {
      await promise;
      throw new Error('Expected the call to reject, but it resolved.');
    } catch (error) {
      return error as HttpException;
    }
  };

  describe('login', () => {
    // An account that has already enrolled asks for the code it can already see, and
    // is given no new secret.
    it('asks an enrolled admin for the code it already has', async () => {
      const { service } = createService();
      const result = await service.login({ email: 'admin@fundi.rw', password: PASSWORD });

      expect(result.enrollmentRequired).toBe(false);
      expect(result.challengeId).toEqual(expect.any(String));
      expect(result.expiresInSeconds).toBe(300);
      expect(result).not.toHaveProperty('otpauthUri');
      expect(result).not.toHaveProperty('secret');
    });

    // The very first sign-in has to hand over a scannable enrolment instead.
    it('returns a scannable enrollment on the first sign-in', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(adminUser);
      const result = await service.login({ email: 'admin@fundi.rw', password: PASSWORD });

      expect(result.enrollmentRequired).toBe(true);
      expect(result.challengeId).toEqual(expect.any(String));
      // The QR code the dashboard renders comes from this URI.
      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
      expect(result.otpauthUri).toContain(`secret=${result.secret}`);
      expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
    });

    // Authenticator apps reject a URI whose issuer differs between the label and the
    // query parameter, so both are asserted rather than one.
    it('puts the issuer in both the label and the query parameter', async () => {
      const { service, prisma } = createService({
        'adminAuth.totpIssuer': 'Fundi Rwanda',
      });
      prisma.user.findUnique.mockResolvedValue(adminUser);
      const result = await service.login({ email: 'admin@fundi.rw', password: PASSWORD });
      expect(result.enrollmentRequired).toBe(true);
      const uri = new URL(result.otpauthUri as string);

      expect(uri.host).toBe('totp');
      expect(decodeURIComponent(uri.pathname)).toBe('/Fundi Rwanda:admin@fundi.rw');
      expect(uri.searchParams.get('issuer')).toBe('Fundi Rwanda');
      expect(uri.searchParams.get('period')).toBe('30');
      expect(uri.searchParams.get('digits')).toBe('6');
    });

    // Each unconfirmed sign-in replaces the last one rather than accumulating secrets.
    it('generates a different secret on every unconfirmed sign-in', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(adminUser);
      const first = await service.login({ email: 'admin@fundi.rw', password: PASSWORD });
      const second = await service.login({ email: 'admin@fundi.rw', password: PASSWORD });

      expect(first.secret).not.toBe(second.secret);
    });

    // A wrong password is refused and counted against the address.
    it('rejects a wrong password and counts the failure', async () => {
      const { service, redisClient } = createService();
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: 'Wrong#Password1' }),
      );

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe('Invalid email or password.');
      expect(redisClient.eval).toHaveBeenCalledTimes(1);
    });

    // An unknown address answers exactly like a wrong password, so the endpoint
    // cannot be used to discover which addresses belong to an administrator.
    it('gives an unknown email the same error as a wrong password', async () => {
      const known = createService();
      const unknown = createService();
      unknown.prisma.user.findUnique.mockResolvedValue(null);

      const wrongPassword = await captureError(
        known.service.login({ email: 'admin@fundi.rw', password: 'Wrong#Password1' }),
      );
      const unknownEmail = await captureError(
        unknown.service.login({ email: 'nobody@fundi.rw', password: PASSWORD }),
      );

      expect(unknownEmail.message).toBe(wrongPassword.message);
      expect(unknownEmail.getStatus()).toBe(wrongPassword.getStatus());
    });

    // A valid password on a non-admin account is refused without revealing why.
    it('refuses a non-admin account with the shared message', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...enrolledAdmin, role: UserRole.CUSTOMER });
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error.message).toBe('Invalid email or password.');
    });

    // A disabled administrator is refused before any challenge is opened. It still
    // counts as a failed attempt, because from the caller's side it is one.
    it('refuses a disabled account without opening a challenge', async () => {
      const { service, prisma, redisClient } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...enrolledAdmin, status: 'INACTIVE' });
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error.message).toBe('Invalid email or password.');
      const challengeCalls = redisClient.eval.mock.calls.filter((call) =>
        call.some((argument: unknown) => String(argument).includes('auth:admin:2fa')),
      );
      expect(challengeCalls).toHaveLength(0);
    });

    // A phone-only account has no password, so it cannot be used as an admin login.
    it('refuses an account that has no password set', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...enrolledAdmin, passwordHash: null });
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error.message).toBe('Invalid email or password.');
    });

    // Once the attempt budget is spent the address is refused before bcrypt runs.
    it('locks a repeatedly failing address out with 429', async () => {
      const { service, redisClient } = createService({ 'adminAuth.maxLoginAttempts': 5 });
      redisClient.get.mockResolvedValue('5');
      redisClient.ttl.mockResolvedValue(420);

      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error.getStatus()).toBe(429);
      expect(error.message).toContain('7 minute');
      expect(redisClient.eval).not.toHaveBeenCalled();
    });

    // A good password clears the accumulated failures so one typo is not fatal.
    it('clears the failure count after a successful sign-in', async () => {
      const { service, redisClient } = createService();
      redisClient.get.mockResolvedValue('4');
      await service.login({ email: 'admin@fundi.rw', password: PASSWORD });

      expect(redisClient.del).toHaveBeenCalledWith(
        expect.stringContaining('auth:admin:login:tries:'),
      );
    });

    // A new sign-in retires the previous challenge so only one is ever live.
    it('supersedes the previous challenge when signing in again', async () => {
      const { service, redisClient } = createService();
      await service.login({ email: 'admin@fundi.rw', password: PASSWORD });

      const createScript = redisClient.eval.mock.calls[0][0] as string;
      expect(createScript).toContain("redis.call('DEL', ARGV[1] .. previous)");
    });

    // A Redis outage must not read as a wrong password.
    it('reports 503 when the rate-limit store is unreachable', async () => {
      const { service, redisClient } = createService();
      redisClient.get.mockRejectedValue(new Error('connection refused'));
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
    });

    // The challenge is opened before the caller sees a success, so a failure to write
    // it has to surface rather than leave a sign-in that can never be finished.
    it('reports 503 when the challenge cannot be opened', async () => {
      const { service, redisClient } = createService();
      redisClient.eval.mockRejectedValue(new Error('connection refused'));
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
    });

    // Without the encryption key an enrolled admin could never be verified, and the
    // failure must name the setting rather than read as a wrong code.
    it('reports 503 when the authenticator secret cannot be read', async () => {
      const { service, totpCrypto } = createService();
      totpCrypto.decrypt.mockImplementation(() => {
        throw new ServiceUnavailableException('Authenticator encryption is not configured.');
      });
      const error = await captureError(service.verifyTwoFactor('challenge-1', currentCode()));

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.message).toContain('not configured');
    });
  });

  describe('verifyTwoFactor', () => {
    // A correct code is the only path that issues a session.
    it('issues tokens and a session row for the code on screen', async () => {
      const { service, prisma, jwt } = createService();
      const result = await service.verifyTwoFactor('challenge-1', currentCode());

      expect(jwt.signAsync).toHaveBeenCalledTimes(2);
      expect(prisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: adminUser.id }) }),
      );
      expect(result.user).toEqual({
        id: adminUser.id,
        fullName: adminUser.fullName,
        email: adminUser.email,
        role: UserRole.ADMIN,
      });
      expect(result.tokens).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      expect(result.expiresInSeconds).toBe(900);
    });

    // Clock skew between the server and a phone is normal, so the neighbouring step
    // has to be accepted rather than locking the admin out at a step boundary.
    it('accepts a code from the neighbouring time step', async () => {
      const { service } = createService();

      await expect(service.verifyTwoFactor('challenge-1', codeAt(-1))).resolves.toBeDefined();
    });

    // The tolerance is one step either side and no more, so it cannot be used to walk
    // the whole six-digit space from a single sign-in.
    it('refuses a code from a distant time step', async () => {
      const { service, prisma } = createService();
      const error = await captureError(service.verifyTwoFactor('challenge-1', codeAt(-4)));

      expect(error.message).toBe('The verification code is incorrect.');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // No session may be created before the code is checked.
    it('refuses when no challenge is pending', async () => {
      const { service, prisma, redisClient } = createService();
      redisClient.hgetall.mockResolvedValue({});

      await expect(service.verifyTwoFactor('missing', '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // A code that is not live is refused and never issues a session.
    it('refuses a code that is not live', async () => {
      const { service, prisma } = createService();

      const error = await captureError(service.verifyTwoFactor('challenge-1', rejectedCode()));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe('The verification code is incorrect.');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // A code of the wrong shape never reaches the comparison.
    it('refuses a code that is not six digits', async () => {
      const { service, prisma } = createService();

      const error = await captureError(service.verifyTwoFactor('challenge-1', '12345'));

      expect(error.message).toBe('The verification code is incorrect.');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // A closed sign-in window is reported separately from a wrong code, so the admin
    // knows to start again rather than to keep guessing.
    it('reports a closed window distinctly from a wrong code', async () => {
      const { service, redisClient } = createService();
      redisClient.eval.mockResolvedValue(-3);

      const error = await captureError(service.verifyTwoFactor('challenge-1', currentCode()));

      expect(error.message).toContain('expired');
    });

    // Guessing is throttled per account, not per code.
    it('throttles repeated wrong codes with 429', async () => {
      const { service, prisma, redisClient } = createService();
      redisClient.eval.mockResolvedValue(-2);

      const error = await captureError(service.verifyTwoFactor('challenge-1', rejectedCode()));

      expect(error.getStatus()).toBe(429);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // The attempt budget is charged before the code is checked, so the throttle covers
    // every guess rather than only the ones that happen to be evaluated.
    it('claims and counts an attempt before checking the code', async () => {
      const { service, redisClient } = createService();
      await captureError(service.verifyTwoFactor('challenge-1', rejectedCode()));

      const claimScript = redisClient.eval.mock.calls[0][0] as string;
      expect(claimScript).toContain("redis.call('HINCRBY', KEYS[1], 'verificationTries', 1)");
      expect(claimScript).toContain("redis.call('INCR', KEYS[2])");
    });

    // The account is re-checked at this point because a challenge outlives a demotion.
    it('refuses to issue a session when the account is no longer an administrator', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...enrolledAdmin, role: UserRole.CUSTOMER });

      await expect(service.verifyTwoFactor('challenge-1', currentCode())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // A challenge whose enrollment was cleared underneath it has to say so plainly.
    it('refuses when the account has no authenticator enrolled', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...enrolledAdmin, totpSecret: null });

      const error = await captureError(service.verifyTwoFactor('challenge-1', currentCode()));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain('no authenticator enrolled');
    });

    // A correct code is spent once. Losing the race to a concurrent request holding
    // the same code is refused rather than minting a second session.
    it('refuses a code that was already spent by a concurrent request', async () => {
      const { service, prisma, redisClient } = createService();
      redisClient.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      const error = await captureError(service.verifyTwoFactor('challenge-1', currentCode()));

      expect(error).toBeInstanceOf(BadRequestException);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('enrolment', () => {
    // Enrolment challenges carry the secret in Redis rather than on the account.
    const enrolmentService = () => {
      const built = createService();
      built.redisClient.hgetall.mockResolvedValue({
        userId: adminUser.id,
        mode: 'enroll',
        secret: TOTP_SECRET,
      });
      return built;
    };

    // The secret is written to the account only once a code has proved the app can
    // produce it, which is what makes the factor usable on every later sign-in.
    it('commits the secret on the first accepted code', async () => {
      const { service, prisma, totpCrypto } = enrolmentService();
      await service.verifyTwoFactor('challenge-1', currentCode());

      expect(totpCrypto.encrypt).toHaveBeenCalledWith(TOTP_SECRET);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: adminUser.id },
          data: expect.objectContaining({
            totpSecret: 'encrypted-blob',
            totpEnabledAt: expect.any(Date),
          }),
        }),
      );
    });

    // An enrolment that is abandoned must leave nothing on the account.
    it('leaves nothing behind when enrolment is abandoned', async () => {
      const { service, prisma, totpCrypto } = enrolmentService();
      await captureError(service.verifyTwoFactor('challenge-1', rejectedCode()));

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(totpCrypto.encrypt).not.toHaveBeenCalled();
    });

    // Once enrolled, the stored secret is used and never rewritten, so a correct
    // code cannot quietly roll the account onto a new one.
    it('does not rewrite the secret on a later sign-in', async () => {
      const { service, prisma, totpCrypto } = createService();
      await service.verifyTwoFactor('challenge-1', currentCode());

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(totpCrypto.encrypt).not.toHaveBeenCalled();
      expect(totpCrypto.decrypt).toHaveBeenCalledWith('encrypted-blob');
    });
  });

  describe('refresh', () => {
    // A valid refresh cookie rotates into a new pair and revokes the old one.
    it('rotates the session', async () => {
      const { service, prisma, tx } = createService();
      const result = await service.refresh('old-refresh-token');

      expect(tx.refreshToken.deleteMany).toHaveBeenCalled();
      expect(tx.refreshToken.create).toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(result.tokens.accessToken).toBe('access-token');
    });

    // An unknown token cannot be exchanged.
    it('refuses an unknown refresh token', async () => {
      const { service, prisma } = createService();
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('nope')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    // A session past its stored expiry cannot be renewed.
    it('refuses an expired session', async () => {
      const { service, prisma } = createService();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'session-1',
        userId: adminUser.id,
        token: 'stored-hash',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('old')).rejects.toThrow(/expired/i);
    });

    // A demoted account cannot keep renewing its session.
    it('refuses renewal for an account that is no longer an administrator', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...enrolledAdmin, role: UserRole.CUSTOMER });

      await expect(service.refresh('old')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('logout', () => {
    // The session is revoked by refresh token alone, with no guard required.
    it('revokes the session named by the refresh token', async () => {
      const { service, prisma } = createService();
      const result = await service.logout('refresh-token-value');

      // Identified by the hashed token alone, with no user id, so signing out still
      // works when the access cookie has already expired and no guard has run.
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { token: expect.any(String) },
      });
      expect(result.message).toBe('Signed out successfully.');
    });

    // Signing out must still succeed when the cookie is already gone, so the
    // dashboard can never be left holding a session it cannot drop.
    it('succeeds when no refresh token is presented', async () => {
      const { service, prisma } = createService();
      const result = await service.logout('');

      expect(result.message).toBe('Signed out successfully.');
      expect(prisma.refreshToken.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('getAdminUser', () => {
    // Returns only the identity fields, never the password hash.
    it('returns the admin identity without the password hash', async () => {
      const { service, prisma } = createService();
      const result = await service.getAdminUser(adminUser.id);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, fullName: true, email: true, role: true },
        }),
      );
      expect(result).toEqual({
        id: adminUser.id,
        fullName: adminUser.fullName,
        email: adminUser.email,
        role: UserRole.ADMIN,
      });
      expect(result).not.toHaveProperty('passwordHash');
    });

    // The encrypted authenticator secret must never reach a caller.
    it('never returns the authenticator secret', async () => {
      const { service, prisma } = createService();
      const result = await service.getAdminUser(adminUser.id);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { id: true, fullName: true, email: true, role: true },
        }),
      );
      expect(result).not.toHaveProperty('totpSecret');
    });

    // A session whose account has been removed cannot be described.
    it('refuses when the account no longer exists', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getAdminUser('gone')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
