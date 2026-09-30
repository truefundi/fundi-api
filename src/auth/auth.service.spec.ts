import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    const prisma = {
      user: { findUnique: jest.fn(), create: jest.fn().mockResolvedValue(activeUser) },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
    };
    const sms = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    const jwt = { signAsync: jest.fn().mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token') };
    const config = { get: jest.fn((_key: string, fallback: string) => fallback) };
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
  it('registers as customer when no role is provided', async () => {
    const { service, prisma } = createService();
    await service.register({
      fullName: activeUser.fullName,
      phoneNumber: activeUser.phoneNumber,
    });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'CUSTOMER' }),
    }));
  });

  // Preserves technician role when explicitly selected during registration.
  it('registers with the technician role when requested', async () => {
    const { service, prisma } = createService();
    await service.register({
      fullName: activeUser.fullName,
      phoneNumber: activeUser.phoneNumber,
      role: 'TECHNICIAN',
    });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: 'TECHNICIAN' }),
    }));
  });

  // Rejects phone login when no matching user record exists.
  it('returns not found for an unknown phone number', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.requestLoginOtp('+250788123456')).rejects.toBeInstanceOf(NotFoundException);
  });

  // Prevents inactive accounts from receiving login codes.
  it('rejects OTP requests for inactive accounts', async () => {
    const { service, prisma, sms } = createService();
    prisma.user.findUnique.mockResolvedValue({ ...activeUser, status: 'INACTIVE' });
    await expect(service.requestLoginOtp(activeUser.phoneNumber)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  // Enforces no more than three resend operations for a pending OTP.
  it('rejects a fourth OTP resend', async () => {
    const { service, prisma, sms, redisClient } = createService();
    prisma.user.findUnique.mockResolvedValue(activeUser);
    redisClient.eval.mockResolvedValue(-2);
    await expect(service.resendOtp(activeUser.phoneNumber)).rejects.toBeInstanceOf(BadRequestException);
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
      user: { fullName: activeUser.fullName, phoneNumber: activeUser.phoneNumber },
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
    await expect(service.verifyOtp(activeUser.phoneNumber, '654321')).rejects.toThrow('The OTP is incorrect.');
  });
});