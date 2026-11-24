import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  TechnicianAvailability,
  TechnicianBusinessType,
  TechnicianGender,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TechnicianDocumentsService } from './documents/technician-documents.service';
import { TechniciansService } from './technicians.service';
import { NationalIdCryptoService } from './national-id-crypto.service';

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
    nationalIdEncrypted: 'encrypted-id',
    nationalIdHash: 'id-hash',
    nationalIdLast4: '1234',
    baseAddress: 'Kigali, Rwanda',
    publicLocationLabel: 'Kigali, Rwanda',
    baseLatitude: -1.95,
    baseLongitude: 30.06,
    paymentMethod: 'MOMO' as const,
    paymentNumber: '+250788123456',
    profilePictureObjectKey: null as string | null,
    profilePictureMimeType: null as string | null,
    verificationStatus: VerificationStatus.PENDING,
    businessType: TechnicianBusinessType.INDIVIDUAL,
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
        findUnique: jest.fn().mockResolvedValue({ phoneVerifiedAt: now }),
      },
      technicianProfile: {
        create: jest.fn().mockResolvedValue(baseProfile()),
        update: jest.fn().mockResolvedValue(baseProfile()),
        findUnique: jest.fn().mockResolvedValue(baseProfile()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(baseProfile()),
      },
      company: {
        create: jest.fn().mockResolvedValue({
          id: 'company-id',
          name: 'Example Company',
          verificationStatus: VerificationStatus.PENDING,
        }),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({
          id: 'company-id',
          name: 'Example Company',
          verificationStatus: VerificationStatus.PENDING,
        }),
        delete: jest.fn().mockResolvedValue({ id: 'company-id' }),
      },
      technicianCategory: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      user: {
        create: jest.fn().mockResolvedValue(baseProfile().user),
        findUnique: jest.fn().mockResolvedValue({ phoneVerifiedAt: now }),
      },
      technicianProfile: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([baseProfile()]),
        findFirst: jest.fn().mockResolvedValue(baseProfile()),
        findUnique: jest.fn().mockResolvedValue(baseProfile()),
      },
      // Ratings and completed jobs behind each profile's stats.
      $queryRaw: jest.fn().mockResolvedValue([]),
      job: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const storage = { getDownloadUrl: jest.fn().mockResolvedValue(signedUrl) };
    const documents = {
      assertReadyForApproval: jest.fn().mockResolvedValue(undefined),
    };
    const nationalIdCrypto = {
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
      hash: jest.fn((value: string) => `hash:${value}`),
      lastFour: jest.fn((value: string) => value.slice(-4)),
    };
    return {
      service: new TechniciansService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
        storage as unknown as StorageService,
        documents as unknown as TechnicianDocumentsService,
        nationalIdCrypto as unknown as NationalIdCryptoService,
      ),
      prisma,
      transaction,
      audit,
      storage,
      documents,
      nationalIdCrypto,
    };
  };

  // A complete, valid registration body matching the new required fields.
  const validRegistration = () => ({
    gender: TechnicianGender.FEMALE,
    nationalIdNumber: '1199080012345678',
    baseAddress: 'Kigali, Rwanda',
    publicLocationLabel: 'Kigali, Rwanda',
    baseLatitude: -1.95,
    baseLongitude: 30.06,
    paymentMethod: 'MOMO' as const,
    paymentNumber: '+250788123456',
    serviceExperiences: [{ categoryId, yearsOfExperience: 5 }],
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

  it('keeps a signed-in customer in customer mode while their technician profile is pending', async () => {
    const { service, transaction, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({
      phoneVerifiedAt: now,
      role: 'CUSTOMER',
    });
    transaction.technicianProfile.findUnique.mockResolvedValue(null);

    await service.registerMyProfile(userId, validRegistration());

    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.technicianProfile.create).toHaveBeenCalled();
  });

  it('creates a pending company with a company-owner technician profile', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);

    await service.registerMyProfile(userId, {
      ...validRegistration(),
      businessType: TechnicianBusinessType.COMPANY,
      company: {
        name: 'Example Company',
        location: 'Kigali, Rwanda',
        email: 'info@example.com',
        phoneNumber: '+250788123456',
      },
    });

    expect(transaction.technicianProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessType: TechnicianBusinessType.COMPANY,
        }),
      }),
    );
    expect(transaction.company.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        technicianId: profileId,
        name: 'Example Company',
        verificationStatus: VerificationStatus.PENDING,
      }),
    });
  });

  it('refuses an application from a phone that was never verified by SMS', async () => {
    const { service, transaction, prisma } = createService();
    for (const role of ['CUSTOMER', 'TECHNICIAN']) {
      prisma.user.findUnique.mockResolvedValue({ phoneVerifiedAt: null, role });
      await expect(
        service.registerMyProfile(userId, validRegistration()),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Verify your phone number'),
      });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(transaction.user.update).not.toHaveBeenCalled();
  });

  it('registers a text-only profile without geocoding it', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);
    const profile = validRegistration();
    delete (profile as Partial<typeof profile>).baseLatitude;
    delete (profile as Partial<typeof profile>).baseLongitude;
    profile.publicLocationLabel = 'Nyamirambo, Kigali';

    await service.registerMyProfile(userId, profile);

    expect(transaction.technicianProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseAddress: 'Kigali, Rwanda',
          publicLocationLabel: 'Nyamirambo, Kigali',
          baseLatitude: null,
          baseLongitude: null,
        }),
      }),
    );
  });

  it('returns null coordinates for a text-only technician profile', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      baseLatitude: null,
      baseLongitude: null,
    });

    await expect(service.getMyProfile(userId)).resolves.toMatchObject({
      location: {
        address: 'Kigali, Rwanda',
        latitude: null,
        longitude: null,
      },
    });
  });

  it('registers a coordinate-only profile without a location label', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);

    await service.registerMyProfile(userId, {
      ...validRegistration(),
      baseAddress: undefined,
      publicLocationLabel: undefined,
    });

    expect(transaction.technicianProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseAddress: '-1.95, 30.06',
          publicLocationLabel: null,
          baseLatitude: -1.95,
          baseLongitude: 30.06,
        }),
      }),
    );
  });

  it('creates a public technician account and profile together', async () => {
    const { service, transaction, audit } = createService();
    const profile = await service.registerPublicTechnician({
      user: {
        fullName: 'Amina Example',
        phoneNumber: '+250788123456',
        email: 'amina@example.com',
      },
      profile: validRegistration(),
    });

    expect(transaction.user.create).toHaveBeenCalledWith({
      data: {
        fullName: 'Amina Example',
        phoneNumber: '+250788123456',
        email: 'amina@example.com',
        role: 'TECHNICIAN',
        status: 'ACTIVE',
      },
    });
    expect(transaction.technicianProfile.create).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'PUBLIC_TECHNICIAN_REGISTRATION_STARTED',
      }),
      transaction,
    );
    expect(profile.verificationStatus).toBe(VerificationStatus.PENDING);
  });

  it('rejects registration missing required fields with a combined list', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);
    await expect(service.registerMyProfile(userId, {})).rejects.toMatchObject({
      message: expect.stringContaining('gender'),
    });
  });

  it('rejects registration when the technician already has a profile', async () => {
    const { service } = createService();
    await expect(
      service.registerMyProfile(userId, validRegistration()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets a rejected technician submit a brand-new application for review', async () => {
    const { service, transaction, audit } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
    });

    await service.registerMyProfile(userId, validRegistration());

    expect(transaction.technicianProfile.create).not.toHaveBeenCalled();
    expect(transaction.technicianCategory.createMany).toHaveBeenCalled();
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith({
      where: { id: profileId },
      data: {
        verificationStatus: VerificationStatus.PENDING,
        availabilityStatus: TechnicianAvailability.OFFLINE,
        rejectionReason: null,
        businessType: TechnicianBusinessType.INDIVIDUAL,
      },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPLICATION_RESUBMITTED',
        fromStatus: VerificationStatus.REJECTED,
        toStatus: VerificationStatus.PENDING,
      }),
      transaction,
    );
  });

  it('creates the company when a rejected technician re-applies as a company', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
    });

    await service.registerMyProfile(userId, {
      ...validRegistration(),
      businessType: TechnicianBusinessType.COMPANY,
      company: {
        name: 'Example Company',
        location: 'Kigali, Rwanda',
        email: 'info@example.com',
        phoneNumber: '+250788123456',
      },
    });

    expect(transaction.company.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        technicianId: profileId,
        name: 'Example Company',
        verificationStatus: VerificationStatus.PENDING,
      }),
    });
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          businessType: TechnicianBusinessType.COMPANY,
        }),
      }),
    );
  });

  it('sends a rejected company back for review with its new details', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
    });
    transaction.company.findUnique.mockResolvedValue({
      id: 'company-id',
      verificationStatus: VerificationStatus.REJECTED,
    });

    await service.registerMyProfile(userId, {
      ...validRegistration(),
      businessType: TechnicianBusinessType.COMPANY,
      company: {
        name: 'Renamed Company',
        location: 'Kigali, Rwanda',
        email: 'Info@Example.com',
        phoneNumber: '+250788123456',
      },
    });

    expect(transaction.company.create).not.toHaveBeenCalled();
    expect(transaction.company.update).toHaveBeenCalledWith({
      where: { id: 'company-id' },
      data: expect.objectContaining({
        name: 'Renamed Company',
        email: 'info@example.com',
        verificationStatus: VerificationStatus.PENDING,
        verifiedAt: null,
      }),
    });
  });

  it('removes an unapproved company when a rejected technician re-applies alone', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
    });
    transaction.company.findUnique.mockResolvedValue({
      id: 'company-id',
      verificationStatus: VerificationStatus.PENDING,
    });

    await service.registerMyProfile(userId, validRegistration());

    expect(transaction.company.delete).toHaveBeenCalledWith({
      where: { id: 'company-id' },
    });
  });

  it('reapplies even when the rejected profile was left online', async () => {
    const { service, transaction } = createService();
    const rejectedOnline = {
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
      availabilityStatus: TechnicianAvailability.ONLINE,
    };
    transaction.technicianProfile.findUnique.mockResolvedValue(rejectedOnline);
    transaction.technicianProfile.findUniqueOrThrow.mockResolvedValue(
      rejectedOnline,
    );

    await expect(
      service.registerMyProfile(userId, validRegistration()),
    ).resolves.toBeDefined();
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          availabilityStatus: TechnicianAvailability.OFFLINE,
        }),
      }),
    );
  });

  it('keeps the ID number on file when a rejected technician reapplies without retyping it', async () => {
    const { service, transaction, nationalIdCrypto } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
    });
    const { nationalIdNumber: _omitted, ...withoutId } = validRegistration();

    await expect(
      service.registerMyProfile(userId, withoutId),
    ).resolves.toBeDefined();
    expect(nationalIdCrypto.encrypt).not.toHaveBeenCalled();
  });

  it('still requires an ID number on reapplication when none is on file', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      nationalIdEncrypted: null,
      verificationStatus: VerificationStatus.REJECTED,
    });
    const { nationalIdNumber: _omitted, ...withoutId } = validRegistration();

    await expect(
      service.registerMyProfile(userId, withoutId),
    ).rejects.toMatchObject({
      message: expect.stringContaining('nationalIdNumber'),
    });
    expect(transaction.technicianProfile.update).not.toHaveBeenCalled();
  });

  it('checks every required field on a reapplication, as on a first one', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
    });
    await expect(
      service.registerMyProfile(userId, { gender: TechnicianGender.FEMALE }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.technicianProfile.update).not.toHaveBeenCalled();
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

  it('updates profile and service experience without changing account identity', async () => {
    const { service, transaction, audit } = createService();
    await service.updateMyProfile(userId, {
      paymentMethod: 'MOMO',
      paymentNumber: '+250788123457',
      serviceExperiences: [{ categoryId, yearsOfExperience: 6 }],
    });

    expect(transaction.user.update).not.toHaveBeenCalled();
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

  it('clears saved coordinates when a text-only location is updated', async () => {
    const { service, transaction } = createService();

    await service.updateMyProfile(userId, {
      publicLocationLabel: 'Nyamirambo, Kigali',
    });

    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          baseLatitude: null,
          baseLongitude: null,
        }),
      }),
    );
    expect(transaction.$executeRaw).toHaveBeenCalled();
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

  it('saves a typed catalog service name as that catalog service', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: profileId }])
      .mockResolvedValueOnce([{ id: categoryId, key: 'plumbing' }])
      .mockResolvedValueOnce([{ id: categoryId }]);
    await service.updateMyProfile(userId, {
      serviceExperiences: [{ customName: ' Plumbing ', yearsOfExperience: 4 }],
    });
    expect(transaction.technicianCategory.createMany).toHaveBeenCalledWith({
      data: [
        {
          technicianId: profileId,
          categoryId,
          customName: null,
          customNameNormalized: '',
          yearsOfExperience: 4,
        },
      ],
    });
  });

  it('reports a service listed by id and by name as a duplicate', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: profileId }])
      .mockResolvedValueOnce([{ id: categoryId, key: 'plumbing' }])
      .mockResolvedValueOnce([{ id: categoryId }]);
    await expect(
      service.updateMyProfile(userId, {
        serviceExperiences: [
          { categoryId, yearsOfExperience: 4 },
          { customName: 'plumbing', yearsOfExperience: 2 },
        ],
      }),
    ).rejects.toThrow('Duplicate service category');
    expect(transaction.technicianCategory.createMany).not.toHaveBeenCalled();
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

  it('saves the admin reason with a rejection so the technician can read it', async () => {
    const { service, transaction, audit } = createService();
    await service.setVerificationStatus(
      profileId,
      VerificationStatus.REJECTED,
      'admin-1',
      '  Your ID photo is unreadable.  ',
    );
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: VerificationStatus.REJECTED,
          rejectionReason: 'Your ID photo is unreadable.',
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          reason: '  Your ID photo is unreadable.  ',
        }),
      }),
      transaction,
    );
  });

  it('refuses a rejection without a reason', async () => {
    const { service, prisma } = createService();
    for (const reason of [undefined, '   ']) {
      await expect(
        service.setVerificationStatus(
          profileId,
          VerificationStatus.REJECTED,
          'admin-1',
          reason,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('clears the old rejection reason when the application is approved', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUniqueOrThrow.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
      rejectionReason: 'Old reason',
    });
    await service.setVerificationStatus(
      profileId,
      VerificationStatus.APPROVED,
      'admin-1',
    );
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ rejectionReason: null }),
      }),
    );
  });

  it('shows the rejection reason to the technician who owns the profile', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findUnique.mockResolvedValue({
      ...baseProfile(),
      verificationStatus: VerificationStatus.REJECTED,
      rejectionReason: 'Your ID photo is unreadable.',
    });
    await expect(service.getMyProfile(userId)).resolves.toMatchObject({
      verificationStatus: VerificationStatus.REJECTED,
      rejectionReason: 'Your ID photo is unreadable.',
    });
  });

  // ─── Account status ────────────────────────────────────────────────────

  it('suspends a technician: updates the account status, forces offline, and logs it', async () => {
    const { service, transaction, audit } = createService();
    await service.setAccountStatusByAdmin(
      profileId,
      UserStatus.SUSPENDED,
      'admin-1',
    );

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
    });
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { availabilityStatus: TechnicianAvailability.OFFLINE },
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'TechnicianProfile',
        entityId: profileId,
        action: 'ACCOUNT_STATUS_UPDATED',
        fromStatus: 'ACTIVE',
        toStatus: UserStatus.SUSPENDED,
        actorId: 'admin-1',
      }),
      transaction,
    );
  });

  it('re-activating a technician keeps its current availability', async () => {
    const { service, transaction } = createService();
    const offlineFreeProfile = {
      ...baseProfile(),
      availabilityStatus: TechnicianAvailability.ONLINE,
      user: { ...baseProfile().user, status: 'INACTIVE' },
    };
    transaction.technicianProfile.findUnique.mockResolvedValue(
      offlineFreeProfile,
    );
    transaction.technicianProfile.update.mockResolvedValue(offlineFreeProfile);

    await service.setAccountStatusByAdmin(
      profileId,
      UserStatus.ACTIVE,
      'admin-1',
    );

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
    });
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { availabilityStatus: TechnicianAvailability.ONLINE },
      }),
    );
  });

  it('leaves the account untouched when the status is already set', async () => {
    const { service, transaction } = createService();
    await service.setAccountStatusByAdmin(
      profileId,
      UserStatus.ACTIVE,
      'admin-1',
    );

    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.technicianProfile.update).not.toHaveBeenCalled();
  });

  it('throws 404 when the technician profile does not exist', async () => {
    const { service, transaction } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);

    await expect(
      service.setAccountStatusByAdmin(
        profileId,
        UserStatus.INACTIVE,
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it('shows real rating and job counts, and none for an unrated technician', async () => {
    const { service, prisma } = createService();
    prisma.$queryRaw.mockResolvedValueOnce([
      { technicianId: profileId, ratingCount: 3, averageScore: 4.333 },
    ]);
    prisma.job.groupBy.mockResolvedValueOnce([
      { technicianId: profileId, _count: { _all: 5 } },
    ]);
    const rated = await service.listAvailable({}, 'anonymous');
    expect(rated.data[0].stats).toEqual({
      averageRating: 4.3,
      ratingCount: 3,
      jobsCompleted: 5,
    });

    const unrated = await service.listAvailable({}, 'anonymous');
    expect(unrated.data[0].stats).toEqual({
      averageRating: null,
      ratingCount: 0,
      jobsCompleted: 0,
    });
  });

  it('filters discovery by category when categoryId is supplied', async () => {
    const { service, prisma } = createService();
    await service.listAvailable({ categoryId }, 'authenticated');
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ categories: { some: { categoryId } } }],
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

  it('pages discovery results with the shared envelope', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.count.mockResolvedValue(7);
    const result = await service.listAvailable(
      { page: 2, limit: 3 },
      'authenticated',
    );

    expect(prisma.technicianProfile.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          verificationStatus: VerificationStatus.APPROVED,
          availabilityStatus: TechnicianAvailability.ONLINE,
        }),
      }),
    );
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 3,
        take: 3,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(result.pagination).toEqual({
      page: 2,
      limit: 3,
      total: 7,
      totalPages: 3,
    });
  });

  it('adds category name, location, and experience filters to discovery', async () => {
    const { service, prisma } = createService();
    await service.listAvailable(
      {
        category: 'Plumbing',
        location: 'kigali',
        minYearsOfExperience: 4,
      },
      'authenticated',
    );
    const call = prisma.technicianProfile.findMany.mock.calls[0][0];
    expect(call.where.AND).toEqual([
      {
        categories: {
          some: {
            category: {
              OR: [
                { name: { equals: 'Plumbing', mode: 'insensitive' } },
                { slug: { equals: 'Plumbing', mode: 'insensitive' } },
              ],
            },
          },
        },
      },
      { categories: { some: { yearsOfExperience: { gte: 4 } } } },
      {
        OR: [
          { baseAddress: { contains: 'kigali', mode: 'insensitive' } },
          { publicLocationLabel: { contains: 'kigali', mode: 'insensitive' } },
        ],
      },
    ]);
    expect(call.where.verificationStatus).toBe(VerificationStatus.APPROVED);
    expect(call.where.availabilityStatus).toBe(TechnicianAvailability.ONLINE);
  });

  it('rejects invalid discovery paging before querying', async () => {
    const { service, prisma } = createService();
    await expect(
      service.listAvailable({ page: 0 }, 'authenticated'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.technicianProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.technicianProfile.count).not.toHaveBeenCalled();
  });

  // ─── Redaction by viewer ───────────────────────────────────────────────

  it('returns the masked national ID and payment fields to the owner', async () => {
    const { service } = createService();
    const result = await service.getMyProfile(userId);
    expect(result.nationalIdNumber).toBe('****1234');
    expect(result).toHaveProperty('paymentMethod');
    expect(result).toHaveProperty('paymentNumber');
  });

  it('redacts payment and omits national ID for authenticated non-owners', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findMany.mockResolvedValue([baseProfile()]);
    const { data } = await service.listAvailable({}, 'authenticated');
    const [result] = data;
    expect(result).not.toHaveProperty('nationalIdNumber');
    expect(result.paymentMethod).toBeNull();
    expect(result.paymentNumber).toBeNull();
    expect(result.user.phoneNumber).toBe('+250788123456');
  });

  it('redacts contact and payment for anonymous viewers', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.findMany.mockResolvedValue([baseProfile()]);
    const { data } = await service.listPublic({});
    const [result] = data;
    expect(result.nationalIdNumber).toBeNull();
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

  // ─── Admin list: filters + pagination ──────────────────────────────────

  it('pages the admin list and returns the shared envelope', async () => {
    const { service, prisma } = createService();
    prisma.technicianProfile.count.mockResolvedValue(42);
    const result = await service.listAllByAdmin({ page: 2, limit: 5 });

    expect(prisma.technicianProfile.count).toHaveBeenCalledWith({ where: {} });
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 5,
        take: 5,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(result.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 42,
      totalPages: 9,
    });
    expect(result.data).toHaveLength(1);
  });

  it('defaults the admin list to page 1 and 20 rows', async () => {
    const { service, prisma } = createService();
    const result = await service.listAllByAdmin();
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 20 }),
    );
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('counts and fetches the admin list with the same where clause', async () => {
    const { service, prisma } = createService();
    await service.listAllByAdmin({
      verificationStatus: VerificationStatus.PENDING,
      availabilityStatus: TechnicianAvailability.OFFLINE,
      status: UserStatus.ACTIVE,
      minYearsOfExperience: 3,
    });

    const countWhere = prisma.technicianProfile.count.mock.calls[0][0].where;
    const findWhere = prisma.technicianProfile.findMany.mock.calls[0][0].where;
    expect(countWhere).toEqual(findWhere);
    expect(findWhere).toEqual({
      AND: [
        { user: { is: { status: UserStatus.ACTIVE } } },
        { verificationStatus: VerificationStatus.PENDING },
        { availabilityStatus: TechnicianAvailability.OFFLINE },
        { categories: { some: { yearsOfExperience: { gte: 3 } } } },
      ],
    });
  });

  it('matches admin list search against name, phone, and email only', async () => {
    const { service, prisma } = createService();
    await service.listAllByAdmin({ search: '  Amina  ' });
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                {
                  user: {
                    is: {
                      fullName: {
                        contains: 'Amina',
                        mode: 'insensitive',
                      },
                    },
                  },
                },
                { user: { is: { phoneNumber: { contains: 'Amina' } } } },
                {
                  user: {
                    is: { email: { contains: 'Amina', mode: 'insensitive' } },
                  },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it('filters the admin list by location text separately from search', async () => {
    const { service, prisma } = createService();
    await service.listAllByAdmin({ location: 'kigali' });
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                {
                  baseAddress: { contains: 'kigali', mode: 'insensitive' },
                },
                {
                  publicLocationLabel: {
                    contains: 'kigali',
                    mode: 'insensitive',
                  },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it('filters the admin list by category name or slug, case-insensitively', async () => {
    const { service, prisma } = createService();
    await service.listAllByAdmin({ category: ' Plumbing ' });
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              categories: {
                some: {
                  category: {
                    OR: [
                      {
                        name: { equals: 'Plumbing', mode: 'insensitive' },
                      },
                      {
                        slug: { equals: 'Plumbing', mode: 'insensitive' },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
    );
  });

  it('rejects invalid paging on the admin list before querying', async () => {
    const { service, prisma } = createService();
    await expect(service.listAllByAdmin({ page: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.listAllByAdmin({ limit: 101 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.technicianProfile.findMany).not.toHaveBeenCalled();
    expect(prisma.technicianProfile.count).not.toHaveBeenCalled();
  });

  it('rejects a blank search or location before querying', async () => {
    const { service, prisma } = createService();
    await expect(
      service.listAllByAdmin({ search: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.listAllByAdmin({ location: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.technicianProfile.findMany).not.toHaveBeenCalled();
  });

  it('applies shared list filters and paging to admin search', async () => {
    const { service, prisma } = createService();
    await service.searchByAdmin({
      query: 'Kigali',
      verificationStatus: VerificationStatus.APPROVED,
      location: 'kigali',
      page: 2,
      limit: 10,
    });

    const call = prisma.technicianProfile.findMany.mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
    expect(call.where.AND).toEqual(
      expect.arrayContaining([
        { verificationStatus: VerificationStatus.APPROVED },
        expect.objectContaining({ OR: expect.any(Array) }),
        expect.objectContaining({ OR: expect.any(Array) }),
      ]),
    );
    expect(call.where.AND).toHaveLength(3);
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
    expect(results.data).toHaveLength(1);
    expect(results.data[0].user.phoneNumber).toBe('+250788123456');
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
    await service.updateMyProfile(userId, { paymentNumber: '+250788123459' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
