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

// Tests technician profile integrity, availability, category and storage-backed image behavior.
describe('TechniciansService', () => {
  const userId = 'technician-user-id';
  const profileId = 'profile-id';
  const categoryId = 'e5a4f4d7-0b21-46d8-9a4b-98765d332100';
  const pictureKey = 'technicians/profile-id/profile.png';
  const signedUrl = 'https://storage.test/signed-url';
  const now = new Date('2026-10-01T10:00:00.000Z');
  const profile = {
    id: profileId,
    userId,
    gender: null,
    yearsOfExperience: null,
    baseAddress: null,
    baseLatitude: null,
    baseLongitude: null,
    profilePictureObjectKey: null as string | null,
    nationalIdEncrypted: null,
    nationalIdHash: null,
    publicLocationLabel: 'Kigali, Rwanda',
    verificationStatus: VerificationStatus.PENDING,
    availabilityStatus: TechnicianAvailability.OFFLINE,
    createdAt: now,
    updatedAt: now,
    user: {
      id: userId,
      fullName: 'Amina Example',
      phoneNumber: '+250788123456',
      email: null,
      role: 'TECHNICIAN',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
    categories: [],
  };

  // Builds transaction-aware database, audit, storage and document doubles for service tests.
  const createService = () => {
    const transaction = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: profileId }])
        .mockResolvedValue([{ id: categoryId }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        create: jest.fn().mockResolvedValue(profile.user),
        update: jest.fn().mockResolvedValue(profile.user),
        delete: jest.fn().mockResolvedValue(profile.user),
      },
      technicianProfile: {
        create: jest.fn().mockResolvedValue(profile),
        update: jest.fn().mockResolvedValue(profile),
        upsert: jest.fn().mockResolvedValue(profile),
        findUnique: jest.fn().mockResolvedValue(profile),
        findUniqueOrThrow: jest.fn().mockResolvedValue(profile),
      },
      technicianCategory: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([profile]),
        findFirst: jest.fn().mockResolvedValue(profile),
        findUnique: jest.fn().mockResolvedValue(profile),
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
    const storage = {
      getDownloadUrl: jest.fn().mockResolvedValue(signedUrl),
    };
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

  // Reads the profile created explicitly through the registration endpoint.
  it('returns an existing pending/offline profile', async () => {
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

  // Requires an explicit POST registration before subsequent profile updates.
  it('registers a partial technician profile once', async () => {
    const { service, transaction, audit } = createService();
    transaction.technicianProfile.findUnique.mockResolvedValue(null);
    await service.registerMyProfile(userId, {
      gender: TechnicianGender.FEMALE,
      publicLocationLabel: 'Kigali',
    });
    expect(transaction.technicianProfile.create).toHaveBeenCalledWith({
      data: { userId },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROFILE_REGISTERED' }),
      transaction,
    );
  });

  // Requires at least one value when registering a new technician profile.
  it('rejects an empty registration body', async () => {
    const { service, prisma } = createService();
    await expect(service.registerMyProfile(userId, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Saves account and technician fields, category links, and location in one transaction.
  it('updates all supplied account and profile fields atomically', async () => {
    const { service, transaction, audit } = createService();
    const result = await service.updateMyProfile(userId, {
      fullName: 'Amina Newname',
      phoneNumber: '+250788123457',
      email: ' AMINA@example.com ',
      gender: TechnicianGender.FEMALE,
      yearsOfExperience: 5,
      categoryIds: [categoryId],
      baseAddress: 'Kigali, Rwanda',
      baseLatitude: -1.95,
      baseLongitude: 30.06,
    });

    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: {
        fullName: 'Amina Newname',
        phoneNumber: '+250788123457',
        email: 'amina@example.com',
      },
    });
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: profileId },
        data: expect.objectContaining({
          gender: TechnicianGender.FEMALE,
          yearsOfExperience: 5,
          availabilityStatus: TechnicianAvailability.OFFLINE,
        }),
      }),
    );
    expect(transaction.technicianCategory.createMany).toHaveBeenCalledWith({
      data: [{ technicianId: profileId, categoryId }],
    });
    expect(transaction.$executeRaw).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATED',
        metadata: expect.objectContaining({ changedFields: expect.any(Array) }),
      }),
      transaction,
    );
    expect(result.user.fullName).toBe('Amina Example');
  });

  // Encrypts and hashes a normalized national ID instead of persisting plaintext.
  it('stores national ID ciphertext and a keyed digest', async () => {
    const { service, transaction, nationalIdCrypto } = createService();
    transaction.technicianProfile.findUniqueOrThrow.mockResolvedValue({
      ...profile,
      nationalIdEncrypted: 'encrypted:ID123456',
      nationalIdHash: 'hash:ID123456',
    });
    const result = await service.updateMyProfile(userId, {
      nationalIdNumber: 'ID-123456',
    });
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
    expect(result.nationalIdNumber).toBe('ID123456');
  });

  // Returns an actionable conflict when the national-ID digest is already unique.
  it('rejects a national ID already assigned to another technician', async () => {
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

  // Prevents a pending technician from making themselves available for jobs.
  it('rejects going online before admin approval', async () => {
    const { service, transaction } = createService();
    await expect(
      service.updateMyAvailability(userId, TechnicianAvailability.ONLINE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transaction.technicianProfile.update).not.toHaveBeenCalled();
  });

  // Requires latitude and longitude to be supplied or cleared as a pair.
  it('rejects an incomplete coordinate pair', async () => {
    const { service, prisma } = createService();
    await expect(
      service.updateMyProfile(userId, { baseLatitude: -1.95 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Translates unique user-field collisions into a client-visible conflict.
  it('returns conflict when a technician updates to an email used by another user', async () => {
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

  // Rejects inactive category assignment during administrator-created technician setup.
  it('rejects inactive categories when an admin creates a technician', async () => {
    const { service, transaction } = createService();
    transaction.$queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: profileId }])
      .mockResolvedValueOnce([]);

    await expect(
      service.createByAdmin(
        {
          user: { fullName: 'Amina Example', phoneNumber: '+250788123456' },
          profile: { categoryIds: [categoryId] },
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.technicianCategory.createMany).not.toHaveBeenCalled();
  });

  // Requires accepted documents (via TechnicianDocumentsService) before an admin can approve.
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
    expect(transaction.technicianProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: VerificationStatus.APPROVED,
        }),
      }),
    );
  });

  // Blocks approval, and writes nothing, when the documents are not ready.
  it('does not approve a technician whose documents are not ready', async () => {
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

  // Returns a signed storage URL when the picture is stored in the bucket.
  it('returns a signed URL when the technician has a profile picture', async () => {
    const { service, prisma, storage } = createService();
    prisma.technicianProfile.findUnique.mockResolvedValue({
      ...profile,
      profilePictureObjectKey: pictureKey,
    });

    const result = await service.getMyProfile(userId);

    expect(storage.getDownloadUrl).toHaveBeenCalledWith(pictureKey);
    expect(result.profilePictureUrl).toBe(signedUrl);
  });

  // Skips the storage call entirely when there is no picture.
  it('returns null and skips storage when there is no profile picture', async () => {
    const { service, storage } = createService();

    const result = await service.getMyProfile(userId);

    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
    expect(result.profilePictureUrl).toBeNull();
  });

  // Searches admin records across technician profile and related user fields.
  it('returns administrator search matches with profile details', async () => {
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

  // Searches national IDs through their keyed digest, never by plaintext storage.
  it('filters administrator national-ID searches by the keyed digest', async () => {
    const { service, prisma, nationalIdCrypto } = createService();
    await service.searchByAdmin({ nationalIdNumber: 'ID123456' });
    expect(nationalIdCrypto.hash).toHaveBeenCalledWith('ID123456');
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ nationalIdHash: 'hash:ID123456' }],
        },
      }),
    );
  });

  // Exposes only active, approved, online technicians to customer discovery.
  it('filters customer results to available technicians', async () => {
    const { service, prisma } = createService();
    await service.listAvailable();
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          verificationStatus: VerificationStatus.APPROVED,
          availabilityStatus: TechnicianAvailability.ONLINE,
          user: {
            is: { status: 'ACTIVE', role: 'TECHNICIAN' },
          },
        },
      }),
    );
  });

  // Ensures the public marketplace projection contains no private contact, ID, or exact GPS fields.
  it('returns a privacy-safe public technician listing with a photo URL and public location', async () => {
    const { service, prisma, storage } = createService();
    prisma.technicianProfile.findMany.mockResolvedValue([
      {
        ...profile,
        nationalIdEncrypted: 'encrypted:ID12345',
        profilePictureObjectKey: pictureKey,
        publicLocationLabel: 'Kigali, Rwanda',
        baseLatitude: -1.95,
        baseLongitude: 30.06,
      },
    ]);
    const results = await service.listPublic();
    expect(storage.getDownloadUrl).toHaveBeenCalledWith(pictureKey);
    expect(results[0]).toMatchObject({
      fullName: 'Amina Example',
      location: 'Kigali, Rwanda',
      profilePictureUrl: signedUrl,
    });
    expect(results[0]).not.toHaveProperty('phoneNumber');
    expect(results[0]).not.toHaveProperty('email');
    expect(results[0]).not.toHaveProperty('nationalIdNumber');
    expect(results[0]).not.toHaveProperty('baseLatitude');
    expect(results[0]).not.toHaveProperty('baseLongitude');
    expect(results[0]).not.toHaveProperty('profilePictureObjectKey');
  });

  // Retries a profile write after PostgreSQL reports a serialization conflict.
  it('retries serializable profile updates', async () => {
    const { service, prisma, transaction } = createService();
    const serializationConflict = new Prisma.PrismaClientKnownRequestError(
      'Transaction write conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    prisma.$transaction
      .mockRejectedValueOnce(serializationConflict)
      .mockImplementationOnce(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      );

    await service.updateMyProfile(userId, { yearsOfExperience: 6 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});