import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { RatingsService } from './ratings.service';

describe('RatingsService', () => {
  const jobId = 'c0d0f493-35af-4601-8307-efda0ee83d7f';
  const customerId = '4c256871-a7c9-46d4-b9d0-8182f6d84fb7';
  const technicianId = '90f96615-2d12-4f17-a7be-367ee33d7835';
  const adminId = '005b68ae-e416-4d6f-9f4f-06c479dbd91d';
  const item1 = {
    id: '00d85d71-96c8-4302-9989-194150e451d1',
    name: 'Communication',
  };
  const item2 = {
    id: '84756e14-f08a-4a43-92b2-c80f2ef1c2a8',
    name: 'Time management',
  };
  const rating = {
    id: '425e477a-e8b7-4838-9716-60f24937a590',
    jobId,
    customerId,
    technicianId,
    submittedById: customerId,
    comment: 'Great work',
    submittedAt: new Date('2026-11-12T10:00:00.000Z'),
    updatedAt: new Date('2026-11-12T10:00:00.000Z'),
    responses: [
      {
        ratingItemId: item1.id,
        itemNameSnapshot: item1.name,
        score: 5,
      },
      {
        ratingItemId: item2.id,
        itemNameSnapshot: item2.name,
        score: 4,
      },
    ],
    customer: { id: customerId, fullName: 'Customer One' },
    submittedBy: {
      id: customerId,
      fullName: 'Customer One',
      role: 'CUSTOMER',
    },
    technician: {
      id: technicianId,
      user: { id: 'tech-user-1', fullName: 'Technician One' },
    },
    job: {
      id: jobId,
      completedAt: new Date('2026-11-12T09:00:00.000Z'),
      serviceCategory: { id: 'service-1', name: 'Plumbing' },
    },
  };
  const job = {
    id: jobId,
    customerId,
    technicianId,
    status: JobStatus.COMPLETED,
    ratedAt: null,
  };

  const setup = () => {
    const tx = {
      ratingItem: {
        create: jest.fn().mockResolvedValue(item1),
        findMany: jest.fn().mockResolvedValue([item1, item2]),
        update: jest.fn().mockResolvedValue(item1),
      },
      jobRating: {
        create: jest.fn().mockResolvedValue(rating),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(rating),
      },
      ratingResponse: {
        update: jest.fn().mockResolvedValue({}),
      },
      job: {
        findUnique: jest.fn().mockResolvedValue(job),
        update: jest.fn().mockResolvedValue({}),
      },
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: technicianId,
          user: { fullName: 'Technician One' },
        }),
      },
    };
    const prisma = {
      ratingItem: {
        findMany: jest.fn().mockResolvedValue([item1, item2]),
        findUnique: jest.fn().mockResolvedValue(item1),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          ratedAt: null,
          status: JobStatus.COMPLETED,
          technicianId,
        }),
      },
      jobRating: {
        findUnique: jest.fn().mockResolvedValue(rating),
        findMany: jest.fn().mockResolvedValue([rating]),
        count: jest.fn().mockResolvedValue(1),
      },
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({
          id: technicianId,
          user: { fullName: 'Technician One' },
        }),
      },
      ratingResponse: {
        aggregate: jest.fn().mockResolvedValue({
          _avg: { score: 4.5 },
          _count: { _all: 2 },
        }),
        groupBy: jest.fn().mockResolvedValue([
          {
            itemNameSnapshot: item1.name,
            _avg: { score: 5 },
            _count: { _all: 1 },
          },
        ]),
      },
      $transaction: jest.fn(
        (callback: (transaction: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new RatingsService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
      ),
      prisma,
      tx,
      audit,
    };
  };

  it('creates rating items and writes an audit entry', async () => {
    const { service, tx, audit } = setup();
    await service.createRatingItem(
      { name: '  Communication ', description: ' Clear updates ' },
      adminId,
    );

    expect(tx.ratingItem.create).toHaveBeenCalledWith({
      data: {
        name: 'Communication',
        description: 'Clear updates',
        sortOrder: 0,
      },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'RatingItem',
        action: 'CREATED',
        actorId: adminId,
      }),
      tx,
    );
  });

  it('archives items rather than removing historical rating references', async () => {
    const { service, tx } = setup();
    await service.archiveRatingItem(item1.id, adminId);

    expect(tx.ratingItem.update).toHaveBeenCalledWith({
      where: { id: item1.id },
      data: { isActive: false },
    });
  });

  it('returns active criteria and existing status only to the completed job owner', async () => {
    const { service, prisma } = setup();
    prisma.jobRating.findUnique.mockResolvedValue(null);
    await expect(service.listItemsForJob(customerId, jobId)).resolves.toEqual({
      jobId,
      items: [item1, item2],
      canSubmit: true,
      rating: null,
    });

    prisma.job.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.listItemsForJob(customerId, jobId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('submits one score per active item and stores the rounded job summary', async () => {
    const { service, tx, audit } = setup();
    const result = await service.submitJobRating(customerId, jobId, {
      responses: [
        { itemId: item1.id, score: 5 },
        { itemId: item2.id, score: 4 },
      ],
      comment: '  Great work ',
    });

    expect(tx.jobRating.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobId,
          customerId,
          technicianId,
          submittedById: customerId,
          comment: 'Great work',
          responses: {
            create: [
              {
                ratingItemId: item1.id,
                itemNameSnapshot: item1.name,
                score: 5,
              },
              {
                ratingItemId: item2.id,
                itemNameSnapshot: item2.name,
                score: 4,
              },
            ],
          },
        }),
      }),
    );
    expect(tx.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: jobId },
        data: expect.objectContaining({ ratingOverall: 5 }),
      }),
    );
    expect(result.averageScore).toBe(4.5);
    expect(result).not.toHaveProperty('customer');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'JobRating',
        action: 'CREATED',
        actorId: customerId,
      }),
      tx,
    );
  });

  it('requires all and only active rating items', async () => {
    const { service, tx } = setup();
    await expect(
      service.submitJobRating(customerId, jobId, {
        responses: [{ itemId: item1.id, score: 5 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.jobRating.create).not.toHaveBeenCalled();
  });

  it('rejects a rating submission from someone who does not own the job', async () => {
    const { service, tx } = setup();
    tx.job.findUnique.mockResolvedValueOnce({
      ...job,
      customerId: 'another-customer',
    });

    await expect(
      service.submitJobRating(customerId, jobId, {
        responses: [
          { itemId: item1.id, score: 5 },
          { itemId: item2.id, score: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.ratingItem.findMany).not.toHaveBeenCalled();
    expect(tx.jobRating.create).not.toHaveBeenCalled();
  });

  it('rejects rating submission when no active criteria exist', async () => {
    const { service, tx } = setup();
    tx.ratingItem.findMany.mockResolvedValueOnce([]);

    await expect(
      service.submitJobRating(customerId, jobId, {
        responses: [
          { itemId: item1.id, score: 5 },
          { itemId: item2.id, score: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.jobRating.create).not.toHaveBeenCalled();
  });

  it('rejects rating jobs that are not completed or already rated', async () => {
    const { service, tx } = setup();
    tx.job.findUnique.mockResolvedValueOnce({
      ...job,
      status: JobStatus.ASSIGNED,
    });
    await expect(
      service.submitJobRating(customerId, jobId, {
        responses: [
          { itemId: item1.id, score: 5 },
          { itemId: item2.id, score: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    tx.job.findUnique.mockResolvedValueOnce({ ...job, ratedAt: new Date() });
    await expect(
      service.submitJobRating(customerId, jobId, {
        responses: [
          { itemId: item1.id, score: 5 },
          { itemId: item2.id, score: 4 },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows admins to correct an existing rating and audits the correction', async () => {
    const { service, tx, audit } = setup();
    tx.jobRating.findUnique.mockResolvedValue({
      ...rating,
      responses: rating.responses,
    });
    await service.updateJobRatingAsAdmin(
      jobId,
      {
        comment: 'Corrected by admin',
        responses: [
          { itemId: item1.id, score: 4 },
          { itemId: item2.id, score: 3 },
        ],
      },
      adminId,
    );

    expect(tx.ratingResponse.update).toHaveBeenCalledTimes(2);
    expect(tx.jobRating.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: rating.id },
        data: { comment: 'Corrected by admin', submittedById: adminId },
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ADMIN_CORRECTED' }),
      tx,
    );
  });

  it('summarizes technician ratings without exposing customer details to the technician', async () => {
    const { service } = setup();
    const result = await service.listMyTechnicianRatings('tech-user-1', {});

    expect(result.summary).toMatchObject({
      ratingCount: 1,
      responseCount: 2,
      averageScore: 4.5,
    });
    expect(result.data[0]).not.toHaveProperty('customer');
    expect(result.data[0].responses).toEqual([
      { itemId: item1.id, item: item1.name, score: 5 },
      { itemId: item2.id, item: item2.name, score: 4 },
    ]);
  });
});
