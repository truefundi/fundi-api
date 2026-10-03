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
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RedisService } from '../redis/redis.service';
import { AdminAuthService } from './admin-auth.service';

// The password step is exercised against a real bcrypt hash rather than a mock, so the
// decoy comparison that hides whether an address exists is genuinely covered. Four
// rounds keeps each comparison in the low milliseconds; production uses twelve.
const PASSWORD = 'Fundi#Admin2026';
const PASSWORD_HASH = hashSync(PASSWORD, 4);

// Verifies the admin credential rules, the two-factor state machine, and session
// handling without any external service.
describe('AdminAuthService', () => {
  const adminUser = {
    id: 'admin-1',
    fullName: 'Alice Mukamana',
    phoneNumber: '+250788123456',
    email: 'admin@fundi.rw',
    role: UserRole.ADMIN,
    status: 'ACTIVE',
    passwordHash: PASSWORD_HASH,
  };

  // Builds an isolated service with mocked database, SMS, JWT, Redis and settings.
  const createService = (overrides: Record<string, unknown> = {}) => {
    const redisClient = {
      get: jest.fn().mockResolvedValue(null),
      ttl: jest.fn().mockResolvedValue(600),
      hgetall: jest.fn().mockResolvedValue({ userId: adminUser.id }),
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
      user: { findUnique: jest.fn().mockResolvedValue(adminUser) },
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: adminUser.id,
          token: 'stored-hash',
          expiresAt: new Date(Date.now() + 3_600_000),
        }),
      },
      $transaction: jest.fn(async (callback: (t: typeof tx) => unknown) => callback(tx)),
    };
    const sms = { sendOtp: jest.fn().mockResolvedValue(undefined) };
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
      sms as unknown as SmsService,
      { getClient: () => redisClient } as unknown as RedisService,
    );
    return { service, prisma, sms, jwt, redisClient, tx };
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
    // Accepts valid credentials, sends the code, and hands back a challenge id.
    it('starts the second factor for a valid admin password', async () => {
      const { service, sms } = createService();
      const result = await service.login({ email: 'admin@fundi.rw', password: PASSWORD });

      expect(sms.sendOtp).toHaveBeenCalledWith(adminUser.phoneNumber, expect.stringMatching(/^\d{6}$/));
      expect(result.challengeId).toEqual(expect.any(String));
      expect(result.maskedPhoneNumber).toBe('+250******456');
      expect(result.expiresInSeconds).toBe(300);
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
      prisma.user.findUnique.mockResolvedValue({ ...adminUser, role: UserRole.CUSTOMER });
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error.message).toBe('Invalid email or password.');
    });

    // A disabled administrator is refused before any code is sent.
    it('refuses a disabled account without sending a code', async () => {
      const { service, prisma, sms } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...adminUser, status: 'INACTIVE' });
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error.message).toBe('Invalid email or password.');
      expect(sms.sendOtp).not.toHaveBeenCalled();
    });

    // A phone-only account has no password, so it cannot be used as an admin login.
    it('refuses an account that has no password set', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...adminUser, passwordHash: null });
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

    // A challenge that cannot be texted is removed rather than left pending.
    it('clears the challenge and reports 503 when the SMS cannot be sent', async () => {
      const { service, sms, redisClient } = createService();
      sms.sendOtp.mockRejectedValue(new Error('provider down'));
      const error = await captureError(
        service.login({ email: 'admin@fundi.rw', password: PASSWORD }),
      );

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(redisClient.del).toHaveBeenCalledWith(
        expect.stringContaining('auth:admin:2fa:'),
        expect.stringContaining('auth:admin:2fa:current:'),
      );
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
  });

  describe('resendTwoFactor', () => {
    // Sends a replacement code for a live challenge.
    it('sends a replacement code', async () => {
      const { service, sms } = createService();
      const result = await service.resendTwoFactor('challenge-1');

      expect(sms.sendOtp).toHaveBeenCalledWith(adminUser.phoneNumber, expect.stringMatching(/^\d{6}$/));
      expect(result.message).toContain('resend');
    });

    // A challenge that never existed cannot be resent against.
    it('rejects a challenge that is not pending', async () => {
      const { service, sms, redisClient } = createService();
      redisClient.hgetall.mockResolvedValue({});

      await expect(service.resendTwoFactor('missing')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sms.sendOtp).not.toHaveBeenCalled();
    });

    // The resend budget is three per challenge and does not reset.
    it('refuses a fourth resend', async () => {
      const { service, sms, redisClient } = createService();
      redisClient.eval.mockResolvedValue(-2);

      await expect(service.resendTwoFactor('challenge-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sms.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyTwoFactor', () => {
    // A correct code is the only path that issues a session.
    it('issues tokens and a session row for a correct code', async () => {
      const { service, prisma, jwt } = createService();
      const result = await service.verifyTwoFactor('challenge-1', '123456');

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

    // No session may be created before the code is checked.
    it('refuses when no challenge is pending', async () => {
      const { service, prisma, redisClient } = createService();
      redisClient.hgetall.mockResolvedValue({});

      await expect(service.verifyTwoFactor('missing', '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // A wrong code is refused and never issues a session.
    it('refuses a wrong code', async () => {
      const { service, prisma, redisClient } = createService();
      redisClient.eval.mockResolvedValue(0);

      const error = await captureError(service.verifyTwoFactor('challenge-1', '000000'));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe('The verification code is incorrect.');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // An expired code is reported as expired so the admin knows to resend.
    it('reports an expired code distinctly from a wrong one', async () => {
      const { service, redisClient } = createService();
      redisClient.eval.mockResolvedValue(-3);

      const error = await captureError(service.verifyTwoFactor('challenge-1', '123456'));

      expect(error.message).toContain('expired');
    });

    // Guessing is throttled per account, not per code.
    it('throttles repeated wrong codes with 429', async () => {
      const { service, prisma, redisClient } = createService();
      redisClient.eval.mockResolvedValue(-2);

      const error = await captureError(service.verifyTwoFactor('challenge-1', '000000'));

      expect(error.getStatus()).toBe(429);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    // The account is re-checked at this point because a challenge outlives a demotion.
    it('refuses to issue a session when the account is no longer an administrator', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue({ ...adminUser, role: UserRole.CUSTOMER });

      await expect(service.verifyTwoFactor('challenge-1', '123456')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
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
      prisma.user.findUnique.mockResolvedValue({ ...adminUser, role: UserRole.CUSTOMER });

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