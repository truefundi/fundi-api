import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RedisService } from '../redis/redis.service';
import { AuthService } from './auth.service';

// Verifies the core account eligibility and OTP limits without external services.
describe('AuthService phone OTP flow', () => {
  const activeUser = {
    id: 'user-1',
    fullName: 'Amina Example',
    phoneNumber: '+250788123456',
    email: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  };

  // Builds an isolated service with mocked database, SMS, JWT, and configuration.
  const createService = () => {
    const redisClient = {
      eval: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };
    const user = {
      findUnique: jest.fn(),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...activeUser, role: data.role }),
        ),
      update: jest.fn().mockResolvedValue({}),
    };
    const customerPhoneVerification = {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    };
    const refreshToken = {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user,
      customerPhoneVerification,
      refreshToken,
    };
    const prisma = {
      user,
      customerPhoneVerification,
      refreshToken,
      $transaction: jest.fn(
        (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    };
    const sms = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    const jwt = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
    };
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    return {
      service: new AuthService(
        jwt as unknown as JwtService,
        config as unknown as ConfigService,
        prisma as unknown as PrismaService,
        sms as unknown as SmsService,
        { getClient: () => redisClient } as unknown as RedisService,
      ),
      prisma,
      sms,
      redisClient,
    };
  };

  // Defaults new self-registered accounts to the customer role.
  it('registers customers without sending a registration OTP', async () => {
    const { service, prisma, sms } = createService();
    await service.register({
      fullName: activeUser.fullName,
      phoneNumber: activeUser.phoneNumber,
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'CUSTOMER' }),
      }),
    );
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('starts OTP verification during technician registration', async () => {
    const { service, prisma, sms } = createService();
    await service.register({
      fullName: activeUser.fullName,
      phoneNumber: activeUser.phoneNumber,
      role: 'TECHNICIAN',
    });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'TECHNICIAN' }),
      }),
    );
    expect(sms.sendOtp).toHaveBeenCalledWith(
      activeUser.phoneNumber,
      expect.any(String),
    );
  });

  it('creates and consumes a separate customer phone verification for a job', async () => {
    const { service, prisma, sms, redisClient } = createService();
    const verification = {
      id: 'verification-1',
      phoneNumber: activeUser.phoneNumber,
      expiresAt: new Date(Date.now() + 300_000),
    };
    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.customerPhoneVerification.create.mockResolvedValue(verification);
    prisma.customerPhoneVerification.findFirst.mockResolvedValue(verification);
    prisma.customerPhoneVerification.updateMany.mockResolvedValue({ count: 1 });
    redisClient.eval.mockResolvedValue(1);

    const issued = await service.requestCustomerJobOtp(activeUser.id);
    expect(issued.verificationId).toBe(verification.id);
    expect(sms.sendOtp).toHaveBeenCalledWith(
      activeUser.phoneNumber,
      expect.any(String),
    );

    const verified = await service.verifyCustomerJobOtp(
      activeUser.id,
      verification.id,
      '123456',
    );
    expect(verified).toMatchObject({
      verificationId: verification.id,
      verifiedAt: expect.any(Date),
    });

    expect(prisma.customerPhoneVerification.updateMany).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: activeUser.id },
        data: {
          phoneNumber: activeUser.phoneNumber,
          phoneVerifiedAt: expect.any(Date),
        },
      }),
    );
  });

  it('sends a customer verification code to a requested replacement phone', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique
      .mockResolvedValueOnce(activeUser)
      .mockResolvedValueOnce(null);
    prisma.customerPhoneVerification.create.mockResolvedValue({
      id: 'verification-2',
      expiresAt: new Date(Date.now() + 300_000),
    });

    await service.requestCustomerJobOtp(activeUser.id, '+250791234567');

    expect(prisma.customerPhoneVerification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phoneNumber: '+250791234567' }),
      }),
    );
    expect(sms.sendOtp).toHaveBeenCalledWith(
      '+250791234567',
      expect.any(String),
    );
  });

  it('updates the customer login phone only after replacement-phone OTP success', async () => {
    const { service, prisma, redisClient } = createService();
    const verification = {
      id: 'verification-3',
      phoneNumber: '+250791234567',
      expiresAt: new Date(Date.now() + 300_000),
    };
    prisma.customerPhoneVerification.findFirst.mockResolvedValue(verification);
    prisma.customerPhoneVerification.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue(activeUser);
    redisClient.eval.mockResolvedValue(1);

    await service.verifyCustomerJobOtp(
      activeUser.id,
      verification.id,
      '123456',
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: activeUser.id },
        data: {
          phoneNumber: '+250791234567',
          phoneVerifiedAt: expect.any(Date),
        },
      }),
    );
  });

  it('rejects a replacement phone already owned by another user', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique
      .mockResolvedValueOnce(activeUser)
      .mockResolvedValueOnce({ id: 'another-user' });

    await expect(
      service.requestCustomerJobOtp(activeUser.id, '+250791234567'),
    ).rejects.toThrow(
      'This phone number is already associated with another account.',
    );
    expect(prisma.customerPhoneVerification.create).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('does not request another job OTP once the customer phone is verified', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      phoneVerifiedAt: new Date(),
    });

    await expect(
      service.requestCustomerJobOtp(activeUser.id),
    ).resolves.toMatchObject({
      verified: true,
      phoneNumber: activeUser.phoneNumber,
    });
    expect(prisma.customerPhoneVerification.create).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('also allows an active technician account to verify a job request phone', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      role: 'TECHNICIAN',
    });
    prisma.customerPhoneVerification.create.mockResolvedValue({
      id: 'verification-2',
      expiresAt: new Date(Date.now() + 300_000),
    });

    await expect(
      service.requestCustomerJobOtp(activeUser.id),
    ).resolves.toMatchObject({ verificationId: 'verification-2' });
  });

  it('sends a technician registration OTP for an already-created account', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      role: 'TECHNICIAN',
    });

    await service.requestTechnicianRegistrationOtp(activeUser.id);

    expect(sms.sendOtp).toHaveBeenCalledWith(
      activeUser.phoneNumber,
      expect.any(String),
    );
  });

  // Rejects phone login when no matching user record exists.
  it('returns not found for an unknown phone number', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.requestLoginOtp('+250788123456'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Prevents inactive accounts from receiving login codes.
  it('rejects OTP requests for inactive accounts', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'INACTIVE',
    });
    await expect(
      service.requestLoginOtp(activeUser.phoneNumber),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  // Administrators sign in with a password and an authenticator, never a texted
  // code, so the phone flow must not even start for their number.
  it('rejects OTP requests for administrator accounts', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, role: 'ADMIN' });
    await expect(
      service.requestLoginOtp(activeUser.phoneNumber),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('rejects OTP resends for administrator accounts', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, role: 'ADMIN' });
    await expect(
      service.resendOtp(activeUser.phoneNumber),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  // Even a code already in flight must not be exchangeable for a bearer token that
  // admin routes would accept.
  it('rejects OTP verification for administrator accounts', async () => {
    const { service, prisma, redisClient } = createService();
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, role: 'ADMIN' });
    redisClient.eval.mockResolvedValue(1);
    await expect(
      service.verifyOtp(activeUser.phoneNumber, '123456'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    expect(redisClient.eval).not.toHaveBeenCalled();
  });

  // Enforces no more than three resend operations for a pending OTP.
  it('rejects a fourth OTP resend', async () => {
    const { service, prisma, sms, redisClient } = createService();
    prisma.user.findUnique.mockResolvedValue(activeUser);
    redisClient.eval.mockResolvedValue(-2);
    await expect(
      service.resendOtp(activeUser.phoneNumber),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  // Returns identity and JWTs after successful OTP validation.
  it('issues tokens for a valid OTP', async () => {
    const { service, prisma, redisClient } = createService();
    const otp = '123456';
    prisma.user.findUnique.mockResolvedValue(activeUser);
    redisClient.eval.mockResolvedValue(1);
    const result = await service.verifyOtp(activeUser.phoneNumber, otp);
    expect(result).toMatchObject({
      user: {
        fullName: activeUser.fullName,
        phoneNumber: activeUser.phoneNumber,
      },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(prisma.refreshToken.create).toHaveBeenCalled();
  });

  // Rejects an OTP that Redis reports as incorrect.
  it('rejects an incorrect OTP', async () => {
    const { service, prisma, redisClient } = createService();
    prisma.user.findUnique.mockResolvedValue(activeUser);
    redisClient.eval.mockResolvedValue(0);
    await expect(
      service.verifyOtp(activeUser.phoneNumber, '654321'),
    ).rejects.toThrow('The OTP is incorrect.');
  });
});

// Covers refresh-token exchange, including the single-use rotation guard.
describe('AuthService refresh token exchange', () => {
  const activeUser = {
    id: 'user-1',
    fullName: 'Amina Example',
    phoneNumber: '+250788123456',
    email: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
  };

  // Builds a service whose transaction callback runs against the same mocked client.
  const createService = (
    overrides: Record<string, unknown> = {},
    settings: Record<string, string> = {},
  ) => {
    const storedSession = {
      id: 'session-row-1',
      sessionId: 'sid-old',
      userId: activeUser.id,
      token: 'hash-of-current-refresh-token',
      deviceId: 'device-old',
      expiresAt: new Date(Date.now() + 60_000),
      ...overrides,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      refreshToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(activeUser) },
      refreshToken: { findUnique: jest.fn().mockResolvedValue(storedSession) },
      $transaction: jest.fn((work: (t: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const jwt = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('new-access-token')
        .mockResolvedValueOnce('new-refresh-token'),
    };
    // No default is forced here: an unset key falls through to the service's own
    // fallback, so these tests cover the shipped default rather than the mock.
    const config = {
      get: jest.fn(
        (key: string, fallback: string) => settings[key] ?? fallback,
      ),
    };
    const service = new AuthService(
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      prisma as unknown as PrismaService,
      { sendOtp: jest.fn() } as unknown as SmsService,
      { getClient: () => ({ eval: jest.fn() }) } as unknown as RedisService,
    );
    return { service, prisma, tx };
  };

  // Returns a new pair and stores the rotated session row.
  it('issues a new token pair for a valid refresh token', async () => {
    const { service, tx } = createService();
    const result = await service.refreshTokens('current-refresh-token');
    expect(result).toMatchObject({
      user: { id: activeUser.id, fullName: activeUser.fullName },
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    expect(tx.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(tx.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deviceId: 'device-old' }),
      }),
    );
  });

  // Rejects a token with no stored session, covering forged and already-revoked values.
  it('rejects an unknown refresh token', async () => {
    const { service, prisma } = createService();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.refreshTokens('nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // Refuses a stored session whose lifetime has already elapsed.
  it('rejects an expired refresh token', async () => {
    const { service } = createService({
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      service.refreshTokens('current-refresh-token'),
    ).rejects.toThrow('The refresh token has expired.');
  });

  // Stops a deactivated account from extending its session.
  it('rejects refresh for an inactive account', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      ...activeUser,
      status: 'INACTIVE',
    });
    await expect(
      service.refreshTokens('current-refresh-token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // A bearer refresh token issued to an administrator before the phone flow was
  // closed must not be able to keep minting admin-capable bearer tokens.
  it('rejects refresh for an administrator account', async () => {
    const { service, prisma, tx } = createService();
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, role: 'ADMIN' });
    await expect(
      service.refreshTokens('current-refresh-token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });

  // Fails the second of two concurrent refreshes so one token cannot mint two pairs.
  it('refuses a refresh token that was already consumed', async () => {
    const { service, tx } = createService();
    tx.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      service.refreshTokens('current-refresh-token'),
    ).rejects.toThrow('The refresh token is invalid or already revoked.');
    expect(tx.refreshToken.create).not.toHaveBeenCalled();
  });

  // Derives the stored expiry from jwt.refreshExpiresIn instead of a fixed constant.
  it('defaults the stored session expiry to thirty days', async () => {
    const { service, tx } = createService();
    const before = Date.now();
    await service.refreshTokens('current-refresh-token');
    const stored = tx.refreshToken.create.mock.calls[0][0].data;
    const seconds = (stored.expiresAt.getTime() - before) / 1000;
    expect(seconds).toBeGreaterThan(29.9 * 86400);
    expect(seconds).toBeLessThan(30.1 * 86400);
  });

  // Honours a shortened configured lifetime rather than always assuming thirty days.
  it('follows a shortened jwt.refreshExpiresIn', async () => {
    const { service, tx } = createService({}, { 'jwt.refreshExpiresIn': '1d' });
    const before = Date.now();
    await service.refreshTokens('current-refresh-token');
    const stored = tx.refreshToken.create.mock.calls[0][0].data;
    const seconds = (stored.expiresAt.getTime() - before) / 1000;
    expect(seconds).toBeGreaterThan(0.9 * 86400);
    expect(seconds).toBeLessThan(1.1 * 86400);
  });
});
