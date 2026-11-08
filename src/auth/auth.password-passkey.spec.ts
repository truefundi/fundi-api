import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RedisService } from '../redis/redis.service';
import { AuthService } from './auth.service';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('bcrypt-hash'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: jest
    .fn()
    .mockResolvedValue({ challenge: 'authentication-challenge' }),
  generateRegistrationOptions: jest
    .fn()
    .mockResolvedValue({ challenge: 'registration-challenge' }),
  verifyAuthenticationResponse: jest.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 2 },
  }),
  verifyRegistrationResponse: jest.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'new-credential',
        publicKey: Buffer.from('public-key'),
        counter: 1,
        transports: ['internal'],
      },
    },
  }),
}));

const bcryptMock = jest.requireMock('bcrypt') as {
  hash: jest.Mock;
  compare: jest.Mock;
};

const webauthnMock = jest.requireMock('@simplewebauthn/server') as {
  generateAuthenticationOptions: jest.Mock;
  generateRegistrationOptions: jest.Mock;
  verifyAuthenticationResponse: jest.Mock;
  verifyRegistrationResponse: jest.Mock;
};

describe('AuthService password and passkey flows', () => {
  const activeUser = {
    id: 'user-1',
    fullName: 'Amina Example',
    phoneNumber: '+250788123456',
    email: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    phoneVerifiedAt: null,
    passwordHash: 'stored-hash',
    pinHash: 'stored-pin-hash',
  };
  const credential = {
    id: 'passkey-row-1',
    credentialId: 'credential-id',
    publicKey: Buffer.from('stored-public-key').toString('base64url'),
    counter: 1n,
    transports: ['internal'],
    userId: activeUser.id,
  };

  const createService = (user = activeUser) => {
    const tx = {
      user: { update: jest.fn().mockResolvedValue({}) },
      refreshToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: activeUser.id,
            fullName: data.fullName,
            phoneNumber: data.phoneNumber,
            role: data.role,
          }),
        ),
      },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      passkeyCredential: {
        findMany: jest.fn().mockResolvedValue([credential]),
        create: jest.fn().mockResolvedValue({
          id: 'passkey-row-new',
          createdAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(
        (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const redisClient = {
      eval: jest
        .fn()
        .mockImplementation((script: string) =>
          script.includes('local challenge') ? 'stored-challenge' : 1,
        ),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    const jwt = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
    };
    const configuration = {
      get: jest.fn((key: string, fallback: unknown) => {
        const values: Record<string, unknown> = {
          'webauthn.rpId': 'example.com',
          'webauthn.rpName': 'Fundi',
          'webauthn.origins': ['https://app.example.com'],
        };
        return values[key] ?? fallback;
      }),
    };
    const service = new AuthService(
      jwt as unknown as JwtService,
      configuration as unknown as ConfigService,
      prisma as unknown as PrismaService,
      { sendOtp: jest.fn() } as unknown as SmsService,
      { getClient: () => redisClient } as unknown as RedisService,
    );
    return { service, prisma, tx, redisClient };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    bcryptMock.hash.mockResolvedValue('bcrypt-hash');
    bcryptMock.compare.mockResolvedValue(true);
    webauthnMock.generateAuthenticationOptions.mockResolvedValue({
      challenge: 'authentication-challenge',
    });
    webauthnMock.generateRegistrationOptions.mockResolvedValue({
      challenge: 'registration-challenge',
    });
    webauthnMock.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 2 },
    });
    webauthnMock.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'new-credential',
          publicKey: Buffer.from('public-key'),
          counter: 1,
          transports: ['internal'],
        },
      },
    });
  });

  it('hashes an optional registration password and never returns it', async () => {
    const { service, prisma } = createService();
    const result = await service.register({
      fullName: activeUser.fullName,
      phoneNumber: activeUser.phoneNumber,
      password: 'secure-password',
    });

    expect(bcryptMock.hash).toHaveBeenCalledWith('secure-password', 12);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ passwordHash: 'bcrypt-hash' }),
      }),
    );
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects passwords that exceed bcrypt’s UTF-8 byte limit', async () => {
    const { service, prisma } = createService();
    await expect(
      service.register({
        fullName: activeUser.fullName,
        phoneNumber: activeUser.phoneNumber,
        password: 'é'.repeat(37),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('hashes a registration PIN separately from the account password', async () => {
    const { service, prisma } = createService();
    const result = await service.registerWithPin({
      fullName: activeUser.fullName,
      phoneNumber: activeUser.phoneNumber,
      pin: '1234',
    });

    expect(bcryptMock.hash).toHaveBeenCalledWith('1234', 12);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pinHash: 'bcrypt-hash',
          role: 'CUSTOMER',
        }),
      }),
    );
    expect(result.user).not.toHaveProperty('pinHash');
  });

  it('rejects a malformed registration PIN before creating an account', async () => {
    const { service, prisma } = createService();
    await expect(
      service.registerWithPin({
        fullName: activeUser.fullName,
        phoneNumber: activeUser.phoneNumber,
        pin: '12ab',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('signs in with a valid password and clears failed attempts', async () => {
    const { service, prisma, redisClient } = createService();
    const result = await service.loginWithPassword(
      activeUser.phoneNumber,
      'secure-password',
    );

    expect(bcryptMock.compare).toHaveBeenCalledWith(
      'secure-password',
      activeUser.passwordHash,
    );
    expect(redisClient.del).toHaveBeenCalledWith(
      `auth:password:attempts:${activeUser.id}`,
    );
    expect(prisma.refreshToken.create).toHaveBeenCalled();
    expect(result).toMatchObject({
      user: { id: activeUser.id },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('signs in with a valid phone PIN and returns a token session', async () => {
    const { service, prisma, redisClient } = createService();
    const result = await service.loginWithPin(activeUser.phoneNumber, '123456');

    expect(bcryptMock.compare).toHaveBeenCalledWith(
      '123456',
      activeUser.pinHash,
    );
    expect(redisClient.del).toHaveBeenCalledWith(
      `auth:password:attempts:${activeUser.id}`,
    );
    expect(prisma.refreshToken.create).toHaveBeenCalled();
    expect(result).toMatchObject({
      user: { id: activeUser.id },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('temporarily refuses a password login after the maximum failed attempts', async () => {
    const { service, redisClient } = createService();
    let attempts = 0;
    redisClient.eval.mockImplementation(async () => ++attempts);
    bcryptMock.compare.mockResolvedValue(false);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        service.loginWithPassword(activeUser.phoneNumber, 'wrong-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      service.loginWithPassword(activeUser.phoneNumber, 'wrong-password'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resets a password only after consuming an OTP and revokes sessions', async () => {
    const { service, redisClient, tx } = createService();
    await service.resetPassword(
      activeUser.phoneNumber,
      '123456',
      'new-secure-password',
    );

    expect(redisClient.eval).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { passwordHash: 'bcrypt-hash' },
      }),
    );
    expect(tx.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: activeUser.id },
    });
  });

  it('stores the passkey registration challenge in Redis', async () => {
    const { service, redisClient } = createService();
    const options = await service.generatePasskeyRegistrationOptions(
      activeUser.id,
    );

    expect(options).toEqual({ challenge: 'registration-challenge' });
    expect(redisClient.set).toHaveBeenCalledWith(
      `auth:passkey:registration:${activeUser.id}`,
      'registration-challenge',
      'EX',
      300,
    );
  });

  it('verifies passkey registration and stores only public credential data', async () => {
    const { service, prisma } = createService();
    const response = {
      id: 'new-credential',
      response: { transports: ['internal'] },
    } as RegistrationResponseJSON;

    await service.verifyPasskeyRegistration(activeUser.id, response);

    expect(prisma.passkeyCredential.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          credentialId: 'new-credential',
          publicKey: Buffer.from('public-key').toString('base64url'),
          counter: 1n,
          transports: ['internal'],
          userId: activeUser.id,
        }),
      }),
    );
  });

  it('verifies a passkey assertion, updates its counter, and creates a session', async () => {
    const user = { ...activeUser, passkeyCredentials: [credential] };
    const { service, prisma } = createService(user);
    const response = {
      id: credential.credentialId,
    } as AuthenticationResponseJSON;

    const result = await service.verifyPasskeyAuthentication(
      activeUser.phoneNumber,
      response,
    );

    expect(prisma.passkeyCredential.updateMany).toHaveBeenCalledWith({
      where: {
        id: credential.id,
        userId: activeUser.id,
        counter: credential.counter,
      },
      data: { counter: 2n },
    });
    expect(result).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
  });

  it('lists only public metadata for the current account’s passkeys', async () => {
    const { service, prisma } = createService();
    await service.listPasskeys(activeUser.id);

    expect(prisma.passkeyCredential.findMany).toHaveBeenCalledWith({
      where: { userId: activeUser.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, transports: true },
    });
  });

  it('removes a passkey only when it belongs to the current account', async () => {
    const { service, prisma } = createService();
    await service.removePasskey(activeUser.id, credential.id);

    expect(prisma.passkeyCredential.deleteMany).toHaveBeenCalledWith({
      where: { id: credential.id, userId: activeUser.id },
    });
  });

  it('does not remove another account’s passkey', async () => {
    const { service, prisma } = createService();
    prisma.passkeyCredential.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      service.removePasskey(activeUser.id, credential.id),
    ).rejects.toThrow('Passkey not found.');
    expect(prisma.passkeyCredential.deleteMany).toHaveBeenCalledWith({
      where: { id: credential.id, userId: activeUser.id },
    });
  });

  it('does not allow administrator accounts to use password sign-in', async () => {
    const { service } = createService({ ...activeUser, role: 'ADMIN' });
    await expect(
      service.loginWithPassword(activeUser.phoneNumber, 'secure-password'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
