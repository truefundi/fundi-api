import { ConflictException, NotFoundException } from '@nestjs/common';
import { DisputeOpenedBy, DisputeOutcome } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { DisputesService } from './disputes.service';

const openJob = {
  id: 'job-open',
  dispute: {
    reason: 'The agreed price was different.',
    openedBy: 'CUSTOMER',
    openedAt: new Date('2026-10-20T10:00:00.000Z'),
  },
};
const resolvedJob = {
  id: 'job-resolved',
  dispute: {
    reason: 'Extra work was billed.',
    openedBy: 'TECHNICIAN',
    openedAt: new Date('2026-10-19T10:00:00.000Z'),
    resolution: {
      outcome: DisputeOutcome.PARTIAL,
      amount: 25000,
      note: 'Only the agreed amount is due.',
      resolvedAt: new Date('2026-10-21T10:00:00.000Z'),
      resolvedBy: 'Fundi Admin',
    },
  },
};
const undisputedJob = { id: 'job-plain', dispute: null };

type PrismaMock = {
  job: { findUnique: jest.Mock };
  technicianProfile: { findFirst: jest.Mock };
  dispute: { findUnique: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
  $transaction: jest.Mock;
};

const createService = () => {
  const jobs = {
    listForAdmin: jest
      .fn()
      .mockResolvedValue([openJob, resolvedJob, undisputedJob]),
    getForAdmin: jest.fn(),
    getCustomerJob: jest.fn(),
    getTechnicianJob: jest.fn(),
  };
  const conversations = {
    getForAdminByJobId: jest.fn().mockResolvedValue(null),
  };
  const prisma: PrismaMock = {
    job: { findUnique: jest.fn() },
    technicianProfile: { findFirst: jest.fn() },
    dispute: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
  );
  const audit = { log: jest.fn() };
  const service = new DisputesService(
    prisma as unknown as PrismaService,
    jobs as unknown as JobsService,
    conversations as unknown as ConversationsService,
    audit as unknown as AuditService,
  );
  return { service, jobs, conversations, prisma, audit };
};

describe('DisputesService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('listForAdmin', () => {
    it('lists disputes that have no resolution by default', async () => {
      const { service } = createService();

      await expect(service.listForAdmin()).resolves.toEqual([openJob]);
    });

    it('lists only resolved disputes when asked', async () => {
      const { service } = createService();

      await expect(service.listForAdmin('resolved')).resolves.toEqual([
        resolvedJob,
      ]);
    });

    it('never lists jobs without a dispute', async () => {
      const { service } = createService();

      const all = [
        ...(await service.listForAdmin('open')),
        ...(await service.listForAdmin('resolved')),
      ];

      expect(all.map((job) => job.id)).not.toContain(undisputedJob.id);
    });
  });

  describe('open', () => {
    const dto = { reason: 'The work was marked complete, but the leak is still present.' };

    it('allows the customer to open a dispute on their job', async () => {
      const { service, prisma, jobs, audit } = createService();
      prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-open',
              customerId: 'cust-1',
              technicianId: 'tech-prof-1',
            }),
          },
          technicianProfile: { findFirst: jest.fn().mockResolvedValue(null) },
          dispute: { create: jest.fn().mockResolvedValue({ id: 'dispute-new' }) },
        };
        return callback(tx);
      });
      jobs.getCustomerJob.mockResolvedValue(openJob);

      await expect(service.open('cust-1', 'job-open', dto)).resolves.toEqual(
        openJob,
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Dispute',
          action: 'DISPUTE_OPENED',
          actorId: 'cust-1',
          metadata: expect.objectContaining({ jobId: 'job-open', openedBy: 'CUSTOMER' }),
        }),
        expect.anything(),
      );
      expect(jobs.getCustomerJob).toHaveBeenCalledWith('cust-1', 'job-open');
    });

    it('allows the assigned technician to open a dispute', async () => {
      const { service, prisma, jobs } = createService();
      prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-open',
              customerId: 'cust-1',
              technicianId: 'tech-prof-1',
            }),
          },
          technicianProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'tech-prof-1' }) },
          dispute: { create: jest.fn().mockResolvedValue({ id: 'dispute-new' }) },
        };
        return callback(tx);
      });
      jobs.getTechnicianJob.mockResolvedValue(openJob);

      await expect(service.open('tech-user', 'job-open', dto)).resolves.toEqual(
        openJob,
      );
      expect(jobs.getTechnicianJob).toHaveBeenCalledWith('tech-user', 'job-open');
    });

    it('404s for a non-participant', async () => {
      const { service, prisma } = createService();
      prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-open',
              customerId: 'cust-1',
              technicianId: 'tech-prof-1',
            }),
          },
          technicianProfile: { findFirst: jest.fn().mockResolvedValue(null) },
          dispute: { create: jest.fn() },
        };
        return callback(tx);
      });

      await expect(
        service.open('stranger', 'job-open', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('conflicts when a dispute already exists', async () => {
      const { service, prisma } = createService();
      prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const err: any = new Error('unique');
        err.code = 'P2002';
        throw err;
      });

      await expect(
        service.open('cust-1', 'job-open', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('conflicts when no technician is assigned', async () => {
      const { service, prisma } = createService();
      prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          job: {
            findUnique: jest.fn().mockResolvedValue({
              id: 'job-open',
              customerId: 'cust-1',
              technicianId: null,
            }),
          },
          technicianProfile: { findFirst: jest.fn() },
          dispute: { create: jest.fn() },
        };
        return callback(tx);
      });

      await expect(
        service.open('cust-1', 'job-open', dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getForAdmin', () => {
    it('returns the disputed job with its chat', async () => {
      const { service, jobs, conversations } = createService();
      const chat = { id: 'conv-1', messages: [] };
      jobs.getForAdmin.mockResolvedValue(openJob);
      conversations.getForAdminByJobId.mockResolvedValue(chat);

      await expect(service.getForAdmin('job-open')).resolves.toEqual({
        job: openJob,
        chat,
      });
      expect(conversations.getForAdminByJobId).toHaveBeenCalledWith('job-open');
    });

    it('returns a null chat when the job never had a conversation', async () => {
      const { service, jobs } = createService();
      jobs.getForAdmin.mockResolvedValue(openJob);

      await expect(service.getForAdmin('job-open')).resolves.toEqual({
        job: openJob,
        chat: null,
      });
    });

    it('404s for a job without a dispute', async () => {
      const { service, jobs } = createService();
      jobs.getForAdmin.mockResolvedValue(undisputedJob);

      await expect(service.getForAdmin('job-plain')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('resolve', () => {
    const dto = {
      outcome: DisputeOutcome.PARTIAL,
      amount: 25000,
      note: '  Only the agreed amount is due.  ',
    };

    it('records the decision once and returns the updated job', async () => {
      const { service, prisma, jobs, audit } = createService();
      prisma.dispute.findUnique.mockResolvedValue({
        id: 'dispute-1',
        resolvedAt: null,
      });
      prisma.dispute.updateMany.mockResolvedValue({ count: 1 });
      jobs.getForAdmin.mockResolvedValue(resolvedJob);

      await expect(service.resolve('job-resolved', dto, 'admin-1')).resolves.toEqual(
        resolvedJob,
      );

      expect(prisma.dispute.updateMany).toHaveBeenCalledWith({
        where: { id: 'dispute-1', resolvedAt: null },
        data: expect.objectContaining({
          outcome: DisputeOutcome.PARTIAL,
          amount: 25000,
          note: 'Only the agreed amount is due.',
          resolvedById: 'admin-1',
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'Dispute',
          entityId: 'dispute-1',
          action: 'DISPUTE_RESOLVED',
          actorId: 'admin-1',
        }),
        prisma,
      );
    });

    it('404s when the job has no dispute', async () => {
      const { service, prisma } = createService();
      prisma.dispute.findUnique.mockResolvedValue(null);

      await expect(
        service.resolve('job-plain', dto, 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to change an already resolved dispute', async () => {
      const { service, prisma } = createService();
      prisma.dispute.findUnique.mockResolvedValue({
        id: 'dispute-1',
        resolvedAt: new Date(),
      });

      await expect(
        service.resolve('job-resolved', dto, 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.dispute.updateMany).not.toHaveBeenCalled();
    });

    it('conflicts when another admin resolved the dispute first', async () => {
      const { service, prisma } = createService();
      prisma.dispute.findUnique.mockResolvedValue({
        id: 'dispute-1',
        resolvedAt: null,
      });
      prisma.dispute.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resolve('job-resolved', dto, 'admin-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('open', () => {
    const job = {
      id: 'job-1',
      customerId: 'customer-1',
      technicianId: 'technician-profile-1',
    };
    const dto = { reason: '  The repair did not fix the leak.  ' };

    it('allows the job customer to open a dispute and returns their job view', async () => {
      const { service, prisma, jobs, audit } = createService();
      prisma.job.findUnique.mockResolvedValue(job);
      prisma.dispute.create.mockResolvedValue({ id: 'dispute-1' });
      jobs.getCustomerJob.mockResolvedValue({ id: 'job-1' });

      await expect(service.open('customer-1', 'job-1', dto)).resolves.toEqual({
        id: 'job-1',
      });

      expect(prisma.dispute.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          reason: 'The repair did not fix the leak.',
          openedBy: 'CUSTOMER',
        },
        select: { id: true },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DISPUTE_OPENED' }),
        prisma,
      );
      expect(jobs.getForAdmin).not.toHaveBeenCalled();
    });

    it('allows only the currently assigned technician to open a dispute', async () => {
      const { service, prisma, jobs } = createService();
      prisma.job.findUnique.mockResolvedValue(job);
      prisma.technicianProfile.findFirst.mockResolvedValue({
        id: 'technician-profile-1',
      });
      prisma.dispute.create.mockResolvedValue({ id: 'dispute-1' });
      jobs.getTechnicianJob.mockResolvedValue({ id: 'job-1' });

      await expect(service.open('technician-user-1', 'job-1', dto)).resolves.toEqual({
        id: 'job-1',
      });

      expect(prisma.dispute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ openedBy: 'TECHNICIAN' }),
        }),
      );
      expect(jobs.getTechnicianJob).toHaveBeenCalledWith(
        'technician-user-1',
        'job-1',
      );
    });

    it('rejects outsiders without revealing whether the job exists', async () => {
      const { service, prisma } = createService();
      prisma.job.findUnique.mockResolvedValue(job);

      await expect(
        service.open('other-user', 'job-1', dto),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.dispute.create).not.toHaveBeenCalled();
    });

    it('rejects disputes before a technician is assigned', async () => {
      const { service, prisma } = createService();
      prisma.job.findUnique.mockResolvedValue({ ...job, technicianId: null });

      await expect(
        service.open('customer-1', 'job-1', dto),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.dispute.create).not.toHaveBeenCalled();
    });
  });
});
