import { BadRequestException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { TechniciansService } from './technicians.service';

// Tests resumable technician profile drafts and active-category assignment rules.
describe('TechniciansService draft profile', () => {
  const userId = 'technician-user-id';
  const categoryId = 'e5a4f4d7-0b21-46d8-9a4b-98765d332100';
  const profile = {
    id: 'profile-id',
    userId,
    onboardingStep: 1,
    yearsOfExperience: null,
    tin: null,
    baseAddress: null,
    baseLatitude: null,
    baseLongitude: null,
    serviceRadiusKm: null,
    verificationStatus: 'DRAFT',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    user: {
      id: userId,
      fullName: 'Amina Example',
      phoneNumber: '+250788123456',
      email: null,
    },
    categories: [],
  };

  // Builds Prisma transaction and audit doubles for profile service tests.
  const createService = () => {
    const transaction = {
      user: { update: jest.fn().mockResolvedValue({}) },
      technicianProfile: {
        upsert: jest.fn().mockResolvedValue(profile),
        findUniqueOrThrow: jest.fn().mockResolvedValue(profile),
      },
      technicianCategory: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      technicianProfile: { upsert: jest.fn().mockResolvedValue(profile) },
      serviceCategory: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new TechniciansService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
      ),
      prisma,
      transaction,
      audit,
    };
  };

  // Creates a draft on first read so the wizard can resume from saved defaults.
  it('lazily creates and returns a DRAFT profile', async () => {
    const { service, prisma } = createService();
    const result = await service.getMyProfile(userId);
    expect(prisma.technicianProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        create: { userId },
      }),
    );
    expect(result).toMatchObject({
      verificationStatus: 'DRAFT',
      onboardingStep: 1,
      categories: [],
    });
  });

  // Persists only provided wizard fields and category assignments together.
  it('saves partial profile fields and active categories', async () => {
    const { service, prisma, transaction, audit } = createService();
    const result = await service.updateProfile(userId, {
      email: ' Amina@example.com ',
      categoryIds: [categoryId],
      baseLatitude: -1.95,
      onboardingStep: 2,
    });
    expect(prisma.serviceCategory.count).toHaveBeenCalledWith({
      where: { id: { in: [categoryId] }, isActive: true },
    });
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { email: 'amina@example.com' },
    });
    expect(transaction.technicianProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId },
        create: expect.objectContaining({
          userId,
          baseLatitude: -1.95,
          onboardingStep: 2,
        }),
        update: expect.objectContaining({
          baseLatitude: -1.95,
          onboardingStep: 2,
        }),
      }),
    );
    expect(transaction.technicianCategory.createMany).toHaveBeenCalledWith({
      data: [{ technicianId: profile.id, categoryId }],
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DRAFT_UPDATED' }),
      transaction,
    );
    expect(result.verificationStatus).toBe('DRAFT');
  });

  // Rejects inactive or unknown categories before writing profile changes.
  it('rejects inactive categories', async () => {
    const { service, prisma } = createService();
    prisma.serviceCategory.count.mockResolvedValue(0);
    await expect(
      service.updateProfile(userId, { categoryIds: [categoryId] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Requires at least one supplied field so empty PUTs are not silently accepted.
  it('rejects empty profile updates', async () => {
    const { service, prisma } = createService();
    await expect(service.updateProfile(userId, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
