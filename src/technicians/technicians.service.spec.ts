import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma,
  TechnicianAvailability,
  TechnicianGender,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TechnicianDocumentsService } from './documents/technician-documents.service';
import { NationalIdCryptoService } from './national-id-crypto.service';
import { TechniciansService } from './technicians.service';

// Tests technician profile integrity, per-service experience, discovery and storage-backed images.
describe('TechniciansService', () => {
  const userId = 'technician-user-id';
  const profileId = 'profile-id';
  const categoryId = 'e5a4f4d7-0b21-46d8-9a4b-98765d332100';
  const secondCategoryId = 'a1b2c3d4-e5f6-4789-9abc-def012345678';
  const pictureKey = 'technicians/profile-id/profile.png';
  const signedUrl = 'https://storage.test/signed-url';
  const now = new Date('2026-10-01T10:00:00.000Z');

  const baseProfile = () => ({
    id: profileId,
    userId,
    gender: TechnicianGender.FEMALE,
    nationalIdEncrypted: 'encrypted:ID123456',
    nationalIdHash: 'hash:ID123456',
    baseAddress: 'Kigali, Rwanda',
    publicLocationLabel: 'Kigali, Rwanda',
    baseLatitude: -1.95,
    baseLongitude: 30.06,
    paymentMethod: 'MOMO' as const,
    paymentNumber: '+250788123456',
    profilePictureObjectKey: null as string | null,
    profilePictureMimeType: null as string | null,
    verificationStatus: VerificationStatus.PENDING,
    availabilityStatus: TechnicianAvailability.OFFLINE,
    createdAt: now,
    updatedAt: now,
    user: {
      id: userId,
      fullName: 'Amina Example',
      phoneNumber: '+250788123456',
      email: null as string | null,
      role: 'TECHNICIAN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
    categories: [] as Array<{
      technicianId: string;
      categoryId: string | null;
      customName: string | null;
      customNameNormalized: string;
      yearsOfExperience: number;
      category: { id: string; name: string; slug: string } | null;
    }>,
  });

  const createService = () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: profileId }])
        .mockResolvedValue([{ id: categoryId }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        create: jest.fn().mockResolvedValue(baseProfile().user),
        update: jest.fn().mockResolvedValue(baseProfile().user),
        delete: jest.fn().mockResolvedValue(baseProfile().user),
      },
      technicianProfile: {
        create: jest.fn().mockResolvedValue(baseProfile()),
        update: jest.fn().mockResolvedValue(baseProfile()),
        findUnique: jest.fn().mockResolvedValue(baseProfile()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(baseProfile()),
      },
      technicianCategory: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([baseProfile()]),
        findFirst: jest.fn().mockResolvedValue(baseProfile()),
        findUnique: jest.fn().mockResolvedValue(baseProfile()),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const nationalIdCrypto = {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
      decrypt: jest.fn((value: string) => value.replace('encrypted:', '')),
      hash: jest.fn((value: string) => `hash:${value}`),
    };
    const storage = { getDownloadUrl: jest.fn().mockResolvedValue(signedUrl) };
    const documents = {
      assertReadyForApproval: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new TechniciansService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
        nationalIdCrypto as unknown as NationalIdCryptoService,
        storage as unknown as StorageService,
        documents as unknown as TechnicianDocumentsService,
      ),
      prisma,
      transaction,
      audit,
      nationalIdCrypto,
      storage,
      documents,
    };
  };

  // A complete, valid registration body matching the new required fields.
  const validRegistration = () => ({
    fullName: 'Amina Example',
    phoneNumber: '+250788123456',
    gender: TechnicianGender.FEMALE,
    nationalIdNumber: 'ID123456',
    baseAddress: 'Kigali, Rwanda',
    publicLocationLabel: 'Kigali, Rwanda',
    baseLatitude: -1.95,
    baseLongitude: 30.06,
    paymentMethod: 'MOMO' as const,
    paymentNumber: '+250788123456',
    serviceExperiences: [
      { categoryId, yearsOfExperience: 5 },
    ],
  });

  // ─── Read ──────────────────────────────────────────────────────────────

  it('returns an existing technician profile to its owner', async () => {
    const { service, prisma } = createService();
    const result = await service.getMyProfile(userId);
    expect(prisma.technicianProfile.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId } }),
    );
    expect(result).toMatchObject({
      verificationStatus: VerificationStatus.PENDING,
      availabilityStatus: TechnicianAvailability.OFFLINE,
      user: { fullName: 'Amina Example', phoneNumber: '+250788123456' },
    });
  });

  it('404s when the technician has not registered yet', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findUnique.mockResolvedValue(null);
    await expect(service.getMyProfile(userId)).rejects.toThrow(
      /Register one first/,
    );
  });

  // ─── Registration ──────────────────────────────────────────────────────

  it('registers a full technician profile once', async () => {
    const { service, transaction, audit } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);
    await service.registerMyProfile(userId, validRegistration());
    expect(transaction.technicianProfile.create).toHaveBeenCalled();
    expect(transaction.technicianCategory.createMany).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROFILE_REGISTERED' }),
      transaction,
    );
  });

    it('rejects registration missing required fields with a combined list', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);
    await expect(
      service.registerMyProfile(userId, {
        fullName: 'Amina Example',
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('gender'),
    });
  });

  it('rejects registration when the technician already has a profile', async () => {
    const { service } = createService();
    await expect(
      service.registerMyProfile(userId, validRegistration()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a service that has both categoryId and customName', async () => {
    const { service, prisma } = createService();
    await expect(
      service.registerMyProfile(userId, {
        ...validRegistration(),
        serviceExperiences: [
          { categoryId, customName: 'Carpentry', yearsOfExperience: 5 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects more than 10 service entries', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);
    await expect(
      service.registerMyProfile(userId, {
        ...validRegistration(),
        serviceExperiences: Array.from({ length: 11 }, (_, i) => ({
          categoryId,
          yearsOfExperience: i,
        })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ─── Update ────────────────────────────────────────────────────────────

  it('updates account, profile, and service experience atomically', async () => {
    const { service, transaction, audit } = createService();
    await service.updateMyProfile(userId, {
      fullName: 'Amina Newname',
      phoneNumber: '+250788123457',
      email: ' AMINA@example.com ',
      paymentMethod: 'MOMO',
      paymentNumber: '+250788123457',
      serviceExperiences: [{ categoryId, yearsOfExperience: 6 }],
    });

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        fullName: 'Amina Newname',
        phoneNumber: '+250788123457',
        email: 'amina@example.com',
      },
    });
    expect(transaction.technicianProfile.update).toHaveBeenCalled();
    expect(transaction.technicianCategory.deleteMany).toHaveBeenCalledWith({
      where: { technicianId: profileId },
    });
    expect(transaction.technicianCategory.createMany).toHaveBeenCalledWith({
      data: [
        {
          technicianId: profileId,
          categoryId,
          customName: null,
          customNameNormalized: '',
          yearsOfExperience: 6,
        },
      ],
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATED',
        metadata: expect.objectContaining({ changedFields: expect.any(Array) }),
      }),
      transaction,
    );
  });

  it('accepts a custom service name when no category matches', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockReset().mockResolvedValue([]);
    await service.updateMyProfile(userId, {
      serviceExperiences: [
        { customName: '  Solar Panel Install ', yearsOfExperience: 3 },
      ],
    });
    expect(transaction.technicianCategory.createMany).toHaveBeenCalledWith({
      data: [
        {
          technicianId: profileId,
          categoryId: null,
          customName: 'Solar Panel Install',
          customNameNormalized: 'solar panel install',
          yearsOfExperience: 3,
        },
      ],
    });
  });

  it('rejects duplicate custom names in the same request', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw.mockReset().mockResolvedValue([]);
    await expect(
      service.updateMyProfile(userId, {
        serviceExperiences: [
          { customName: 'Solar', yearsOfExperience: 3 },
          { customName: 'solar', yearsOfExperience: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an inactive or unknown category id', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: profileId }])
      .mockResolvedValueOnce([]);
    await expect(
      service.updateMyProfile(userId, {
        serviceExperiences: [{ categoryId, yearsOfExperience: 3 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.technicianCategory.createMany).not.toHaveBeenCalled();
  });

  it('encrypts and hashes a national ID before persisting', async () => {
    const { service, transaction, nationalIdCrypto } = createService();
    await service.updateMyProfile(userId, { nationalIdNumber: 'ID-123456' });
    expect(nationalIdCrypto.encrypt).toHaveBeenCalledWith('ID-123456');
    expect(nationalIdCrypto.hash).toHaveBeenCalledWith('ID-123456');
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nationalIdEncrypted: 'encrypted:ID-123456',
          nationalIdHash: 'hash:ID-123456',
        }),
      }),
    );
  });

  it('returns conflict when the national ID is already taken', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['nationalIdHash'] },
      }),
    );
    await expect(
      service.updateMyProfile(userId, { nationalIdNumber: 'ID-123456' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents going online before approval', async () => {
    const { service, transaction } = createService();
    await expect(
      service.updateMyAvailability(userId, TechnicianAvailability.ONLINE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.technicianProfile.update).not.toHaveBeenCalled();
  });

  it('rejects an incomplete coordinate pair', async () => {
    const { service, prisma } = createService();
    await expect(
      service.updateMyProfile(userId, { baseLatitude: -1.95 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns conflict when an email is already used', async () => {
    const { service, transaction } = createService();
    transaction.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['email'] },
      }),
    );
    await expect(
      service.updateMyProfile(userId, { email: 'taken@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ─── Admin ─────────────────────────────────────────────────────────────

  it('rejects an admin create that is missing required profile fields', async () => {
    const { service, prisma } = createService();
    await expect(
      service.createByAdmin(
        {
          user: { fullName: 'Amina Example', phoneNumber: '+250788123456' },
          profile: {},
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('checks documents before an admin approves a technician', async () => {
    const { service, transaction, documents } = createService();
    await service.setVerificationStatus(
      profileId,
      VerificationStatus.APPROVED,
      'admin-1',
    );
    expect(documents.assertReadyForApproval).toHaveBeenCalledWith(
      transaction,
      profileId,
    );
    expect(transaction.technicianProfile.update).toHaveBeenCalled();
  });

  it('does not approve when documents are not ready', async () => {
    const { service, transaction, documents } = createService();
    documents.assertReadyForApproval.mockRejectedValue(
      new BadRequestException('Required documents are missing.'),
    );
    await expect(
      service.setVerificationStatus(
        profileId,
        VerificationStatus.APPROVED,
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.technicianProfile.update).not.toHaveBeenCalled();
  });

  // ─── Discovery ─────────────────────────────────────────────────────────

  it('lists only active, approved, online technicians to authenticated viewers', async () => {
    const { service, prisma } = createService();
    await service.listAvailable({}, 'authenticated');
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verificationStatus: VerificationStatus.APPROVED,
          availabilityStatus: TechnicianAvailability.ONLINE,
          user: {
            is: { status: 'ACTIVE', role: 'TECHNICIAN' },
          },
        }),
      }),
    );
  });

  it('filters discovery by category when categoryId is supplied', async () => {
    const { service, prisma } = createService();
    await service.listAvailable({ categoryId }, 'authenticated');
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          categories: { some: { categoryId } },
        }),
      }),
    );
  });

  it('lists approved technicians regardless of availability for listApproved', async () => {
    const { service, prisma } = createService();
    await service.listApproved({}, 'authenticated');
    const call = prisma.technicianProfile.findMany.mock.calls[0][0];
    expect(call.where.verificationStatus).toBe(VerificationStatus.APPROVED);
    expect(call.where.availabilityStatus).toBeUndefined();
  });

  // ─── Redaction by viewer ───────────────────────────────────────────────

  it('returns national ID and payment fields to the owner', async () => {
    const { service } = createService();
    const result = await service.getMyProfile(userId);
    expect(result).toHaveProperty('nationalIdNumber');
    expect(result).toHaveProperty('paymentMethod');
    expect(result).toHaveProperty('paymentNumber');
  });

  it('redacts payment and national ID for authenticated non-owners', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findMany.mockResolvedValue([baseProfile()]);
    const [result] = await service.listAvailable({}, 'authenticated');
    expect(result.nationalIdNumber).toBeNull();
    expect(result.paymentMethod).toBeNull();
    expect(result.paymentNumber).toBeNull();
    expect(result.user.phoneNumber).toBe('+250788123456');
  });

  it('redacts contact, payment, and national ID for anonymous viewers', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findMany.mockResolvedValue([baseProfile()]);
    const [result] = await service.listPublic({});
    expect(result.user).toEqual({
      id: userId,
      fullName: 'Amina Example',
      role: 'TECHNICIAN',
      phoneNumber: null,
      email: null,
      status: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(result.paymentMethod).toBeNull();
    expect(result.paymentNumber).toBeNull();
    expect(result.nationalIdNumber).toBeNull();
  });

  // ─── Derived experience + picture ──────────────────────────────────────

  it('derives yearsOfExperience as the maximum across services', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      categories: [
        {
          technicianId: profileId,
          categoryId,
          customName: null,
          customNameNormalized: '',
          yearsOfExperience: 5,
          category: { id: categoryId, name: 'Carpentry', slug: 'carpentry' },
        },
        {
          technicianId: profileId,
          categoryId: secondCategoryId,
          customName: null,
          customNameNormalized: '',
          yearsOfExperience: 9,
          category: {
            id: secondCategoryId,
            name: 'Plumbing',
            slug: 'plumbing',
          },
        },
      ],
    });
    const result = await service.getMyProfile(userId);
    expect(result.yearsOfExperience).toBe(9);
    expect(result.serviceExperiences).toHaveLength(2);
  });

  it('returns a signed URL when the technician has a profile picture', async () => {
    const { service, prisma, storage } = createService();
    prisma.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      profilePictureObjectKey: pictureKey,
    });
    const result = await service.getMyProfile(userId);
    expect(storage.getDownloadUrl).toHaveBeenCalledWith(pictureKey);
    expect(result.profilePictureUrl).toBe(signedUrl);
  });

  it('returns null and skips storage when there is no picture', async () => {
    const { service, storage } = createService();
    const result = await service.getMyProfile(userId);
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
    expect(result.profilePictureUrl).toBeNull();
  });

  // ─── Admin search ──────────────────────────────────────────────────────

  it('searches admin records across profile and user fields', async () => {
  const { service, prisma } = createService();
  const results = await service.searchByAdmin({ query: 'Amina' });
  expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ AND: expect.any(Array) }),
    }),
  );
  expect(results).toHaveLength(1);
  expect(results[0].user.phoneNumber).toBe('+250788123456');
});



  it('filters national-ID search by keyed digest, not plaintext', async () => {
    const { service, prisma, nationalIdCrypto } = createService();
    await service.searchByAdmin({ nationalIdNumber: 'ID123456' });
    expect(nationalIdCrypto.hash).toHaveBeenCalledWith('ID123456');
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ nationalIdHash: 'hash:ID123456' }] },
      }),
    );
  });

  it('requires at least one identifier in searchByUserDetails', async () => {
    const { service, prisma } = createService();
    await expect(service.searchByUserDetails({})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.technicianProfile.findMany).not.toHaveBeenCalled();
  });

  it('searches user details by phone number', async () => {
    const { service, prisma } = createService();
    await service.searchByUserDetails({ phoneNumber: '+250788123456' });
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user: { is: { phoneNumber: '+250788123456' } },
        },
      }),
    );
  });

  // ─── Serialization retry ───────────────────────────────────────────────

  it('retries serializable profile updates', async () => {
    const { service, prisma, transaction } = createService();
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Transaction write conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    prisma.$transaction
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      );
    await service.updateMyProfile(userId, { fullName: 'Amina Retry' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
