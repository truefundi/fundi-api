import { ConflictException, NotFoundException } from '@nestjs/common';
import { DisputeOutcome } from '@prisma/client';
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
  dispute: { findUnique: jest.Mock; updateMany: jest.Mock };
  $transaction: jest.Mock;
};

const createService = () => {
  const jobs = {
    listForAdmin: jest
      .fn()
      .mockResolvedValue([openJob, resolvedJob, undisputedJob]),
    getForAdmin: jest.fn(),
  };
  const conversations = {
    getForAdminByJobId: jest.fn().mockResolvedValue(null),
  };
  const prisma: PrismaMock = {
    dispute: { findUnique: jest.fn(), updateMany: jest.fn() },
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
});
