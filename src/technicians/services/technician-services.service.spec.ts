import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, VerificationStatus } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TechniciansService } from '../technicians.service';
import { TechnicianServicesService } from './technician-services.service';

const userId = 'user-1';
const profileId = 'profile-1';
const adminId = 'admin-1';
const plumbingId = '11111111-1111-4111-8111-111111111111';
const carpentryId = '22222222-2222-4222-8222-222222222222';

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'service-1',
  technicianId: profileId,
  categoryId: carpentryId,
  customName: null,
  customNameNormalized: '',
  yearsOfExperience: 3,
  status: VerificationStatus.PENDING,
  reviewNote: null,
  reviewedById: null,
  reviewedAt: null,
  createdAt: new Date('2026-11-24T10:00:00Z'),
  updatedAt: new Date('2026-11-24T10:00:00Z'),
  category: { id: carpentryId, name: 'Carpentry', slug: 'carpentry' },
  ...overrides,
});

describe('TechnicianServicesService', () => {
  const setup = (
    verificationStatus: VerificationStatus = VerificationStatus.APPROVED,
  ) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: profileId }]),
      technicianCategory: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { categoryId: plumbingId, customNameNormalized: '' },
          ]),
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(row(data))),
      },
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: carpentryId }),
      },
    };
    const prisma = {
      technicianProfile: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: profileId, verificationStatus }),
      },
      technicianCategory: {
        findFirst: jest.fn().mockResolvedValue(row()),
        findUnique: jest.fn().mockResolvedValue({
          ...row(),
          technician: { id: profileId, userId },
        }),
        update: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve(row(data))),
        delete: jest.fn().mockResolvedValue(row()),
      },
      $transaction: jest.fn((callback: (t: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const notifications = { create: jest.fn().mockResolvedValue(undefined) };
    const technicians = {
      linkCatalogNames: jest.fn((_tx: unknown, items: unknown[]) =>
        Promise.resolve(items),
      ),
    };
    const service = new TechnicianServicesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      notifications as unknown as NotificationsService,
      technicians as unknown as TechniciansService,
    );
    return { service, prisma, tx, audit, notifications, technicians };
  };

  it('adds a service as pending for an approved technician', async () => {
    const { service, tx, audit } = setup();
    const result = await service.add(userId, {
      categoryId: carpentryId,
      yearsOfExperience: 3,
    });
    expect(tx.technicianCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          technicianId: profileId,
          categoryId: carpentryId,
          status: VerificationStatus.PENDING,
        }),
      }),
    );
    expect(result.status).toBe(VerificationStatus.PENDING);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SERVICE_REQUESTED' }),
      tx,
    );
  });

  it('keeps services in the application until it is approved', async () => {
    const { service, tx } = setup(VerificationStatus.PENDING);
    await expect(
      service.add(userId, { categoryId: carpentryId, yearsOfExperience: 3 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.technicianCategory.create).not.toHaveBeenCalled();
  });

  it('refuses a service the technician already lists', async () => {
    const { service, tx } = setup();
    await expect(
      service.add(userId, { categoryId: plumbingId, yearsOfExperience: 3 }),
    ).rejects.toThrow('You already list this service.');
    expect(tx.technicianCategory.create).not.toHaveBeenCalled();
  });

  it('refuses a category Fundi does not offer', async () => {
    const { service, tx } = setup();
    tx.serviceCategory.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.add(userId, { categoryId: carpentryId, yearsOfExperience: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sends a rejected service back to review and clears the reason', async () => {
    const { service, prisma } = setup();
    prisma.technicianCategory.findFirst.mockResolvedValueOnce(
      row({
        status: VerificationStatus.REJECTED,
        reviewNote: 'Add a certificate.',
      }),
    );
    const result = await service.update(userId, 'service-1', {
      yearsOfExperience: 4,
    });
    expect(prisma.technicianCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          yearsOfExperience: 4,
          status: VerificationStatus.PENDING,
          reviewNote: null,
        }),
      }),
    );
    expect(result.status).toBe(VerificationStatus.PENDING);
  });

  it('does not let a technician change or withdraw an approved service', async () => {
    const { service, prisma } = setup();
    prisma.technicianCategory.findFirst.mockResolvedValue(
      row({ status: VerificationStatus.APPROVED }),
    );
    await expect(
      service.update(userId, 'service-1', { yearsOfExperience: 9 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.withdraw(userId, 'service-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.technicianCategory.delete).not.toHaveBeenCalled();
  });

  it("does not touch another technician's service", async () => {
    const { service, prisma } = setup();
    prisma.technicianCategory.findFirst.mockResolvedValueOnce(null);
    await expect(service.withdraw(userId, 'service-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('requires a reason to reject, and notifies the technician', async () => {
    const { service, prisma, notifications } = setup();
    await expect(
      service.review('service-1', adminId, {
        status: 'REJECTED',
        reason: '  ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.review('service-1', adminId, {
      status: 'REJECTED',
      reason: 'Add a carpentry certificate.',
    });
    expect(prisma.technicianCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VerificationStatus.REJECTED,
          reviewNote: 'Add a carpentry certificate.',
          reviewedById: adminId,
        }),
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        type: NotificationType.SYSTEM,
        title: 'Carpentry not approved',
        body: 'Reason: Add a carpentry certificate. You can change it and send it again from your services.',
      }),
    );
  });

  it('approves a service and clears any old reason', async () => {
    const { service, prisma, notifications } = setup();
    const result = await service.review('service-1', adminId, {
      status: 'APPROVED',
    });
    expect(prisma.technicianCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: VerificationStatus.APPROVED,
          reviewNote: null,
        }),
      }),
    );
    expect(result.status).toBe(VerificationStatus.APPROVED);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Carpentry approved' }),
    );
  });

  it('shows the admin a certificate reused from another service', async () => {
    const { service, prisma } = setup();
    const pending = {
      ...row(),
      technician: {
        id: profileId,
        verificationStatus: VerificationStatus.APPROVED,
        user: { id: userId, fullName: 'Alex', phoneNumber: '+250700000000' },
      },
    };
    Object.assign(prisma.technicianCategory, {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([pending]),
    });
    const certificate = (id: string, categoryId: string, links: string[]) => ({
      id,
      technicianId: profileId,
      title: id,
      status: 'ACCEPTED',
      certificateType: 'TVET_CERTIFICATE',
      categoryId,
      customCategoryNormalized: null,
      createdAt: new Date('2026-11-20T10:00:00Z'),
      serviceCategories: links.map((serviceCategoryId) => ({ serviceCategoryId })),
    });
    Object.assign(prisma, {
      technicianDocument: {
        findMany: jest.fn().mockResolvedValue([
          // Uploaded for plumbing, then reused for carpentry.
          certificate('reused-cert', plumbingId, [plumbingId, carpentryId]),
          // Plumbing only: not evidence for carpentry.
          certificate('plumbing-only', plumbingId, [plumbingId]),
        ]),
      },
    });

    const result = await service.listForReview({});

    expect(result.data[0].certificates).toEqual([
      expect.objectContaining({ id: 'reused-cert', reused: true }),
    ]);
  });
});
