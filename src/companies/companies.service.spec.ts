import { ConflictException } from '@nestjs/common';
import {
  Company,
  TechnicianBusinessType,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CompaniesService } from './companies.service';

describe('CompaniesService', () => {
  const company: Company = {
    id: 'company-1',
    technicianId: 'technician-profile-1',
    name: 'Fundi Plumbing Ltd',
    location: 'Kigali, Rwanda',
    email: 'info@example.com',
    phoneNumber: '+250788123456',
    description: null as string | null,
    verificationStatus: VerificationStatus.PENDING,
    verifiedAt: null as Date | null,
    verifiedById: null as string | null,
    createdAt: new Date('2026-11-18T07:00:00.000Z'),
    updatedAt: new Date('2026-11-18T07:00:00.000Z'),
  };

  const createService = () => {
    const tx = {
      company: {
        create: jest.fn().mockResolvedValue(company),
        findFirst: jest.fn().mockResolvedValue(company),
        findUnique: jest.fn().mockResolvedValue(company),
        update: jest.fn(({ data }: { data?: object }) =>
          Promise.resolve({ ...company, ...data }),
        ),
        delete: jest.fn().mockResolvedValue(company),
      },
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: company.technicianId,
          businessType: TechnicianBusinessType.INDIVIDUAL,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const prisma = {
      company: {
        findMany: jest.fn().mockResolvedValue([company]),
        findFirst: jest.fn().mockResolvedValue(company),
        findUnique: jest.fn().mockResolvedValue(company),
      },
      $transaction: jest.fn(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new CompaniesService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
      ),
      prisma,
      tx,
      audit,
    };
  };

  it('lets the owner update a pending company and requeues it for review', async () => {
    const { service, tx, audit } = createService();
    await service.updateMine('user-1', { name: 'Updated Plumbing Ltd' });

    expect(tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Updated Plumbing Ltd',
          verificationStatus: VerificationStatus.PENDING,
          verifiedAt: null,
          verifiedBy: { disconnect: true },
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'OWNER_UPDATED' }),
      tx,
    );
  });

  it('prevents the owner from editing an approved company', async () => {
    const { service, tx } = createService();
    tx.company.findFirst.mockResolvedValue({
      ...company,
      verificationStatus: VerificationStatus.APPROVED,
    });

    await expect(
      service.updateMine('user-1', { name: 'Updated Plumbing Ltd' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.company.update).not.toHaveBeenCalled();
  });

  it('records who approved a company', async () => {
    const { service, tx, audit } = createService();
    tx.company.update.mockImplementation(
      ({ data }: { data?: object }) =>
        Promise.resolve({
          ...company,
          ...data,
          verificationStatus: VerificationStatus.APPROVED,
        }),
    );

    await service.updateVerification(
      company.id,
      { verificationStatus: VerificationStatus.APPROVED },
      'admin-1',
    );

    expect(tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: VerificationStatus.APPROVED,
          verifiedBy: { connect: { id: 'admin-1' } },
          verifiedAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'VERIFICATION_STATUS_UPDATED' }),
      tx,
    );
  });

  it('resets the technician business type when an admin deletes a company', async () => {
    const { service, tx } = createService();
    await expect(
      service.deleteByAdmin(company.id, 'admin-1'),
    ).resolves.toEqual({ id: company.id, deleted: true });

    expect(tx.company.delete).toHaveBeenCalledWith({
      where: { id: company.id },
    });
    expect(tx.technicianProfile.update).toHaveBeenCalledWith({
      where: { id: company.technicianId },
      data: { businessType: TechnicianBusinessType.INDIVIDUAL },
    });
  });
});
