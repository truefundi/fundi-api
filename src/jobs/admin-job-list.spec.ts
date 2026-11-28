import { BadRequestException } from '@nestjs/common';
import { JobPriority, JobStatus } from '@prisma/client';
import { JobsService } from './jobs.service';
import {
  adminJobListResponse,
  adminJobWhere,
  ADMIN_JOB_LIST_SELECT,
} from './admin-job-list';
import { AdminJobGroup, AdminJobSort } from './dto/list-admin-jobs-query.dto';
import { SortOrder } from '../common/dto/admin-list-query.dto';

describe('Admin job pagination', () => {
  function setup(total = 21) {
    const prisma = {
      job: {
        count: jest.fn().mockResolvedValue(total),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new JobsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  }

  it('bounds the database read, uses the same filter for the count and rows, and retains the requested empty page', async () => {
    const { prisma, service } = setup();
    const result = await service.listPageForAdmin({
      page: 4,
      limit: 10,
      search: 'pipe',
      status: JobStatus.OPEN,
      priority: JobPriority.HIGH,
      sortBy: AdminJobSort.OFFERED_AMOUNT,
      sortOrder: SortOrder.ASC,
    });
    expect(result).toEqual({
      data: [],
      pagination: { page: 4, limit: 10, total: 21, totalPages: 3 },
    });
    const args = prisma.job.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 30,
      take: 10,
      orderBy: [{ offeredAmount: 'asc' }, { id: 'asc' }],
      select: ADMIN_JOB_LIST_SELECT,
    });
    expect(prisma.job.count).toHaveBeenCalledWith({ where: args.where });
    expect(args.where).toMatchObject({
      priority: 'HIGH',
      AND: expect.arrayContaining([{ status: 'OPEN' }]),
    });
    expect(args.select).not.toHaveProperty('offers');
    expect(args.select).not.toHaveProperty('assignmentHistory');
    expect(args.select).not.toHaveProperty('media');
  });

  it('uses a default bounded page and deterministic newest-first ordering', async () => {
    const { prisma, service } = setup(0);
    expect((await service.listPageForAdmin({})).pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    expect(prisma.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        skip: 0,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it.each([
    { page: 0 },
    { limit: 101 },
    { page: Number.MAX_SAFE_INTEGER },
    { limit: 1.5 },
  ])('rejects unsafe paging before any database access: %j', async (query) => {
    const { service, prisma } = setup();
    await expect(service.listPageForAdmin(query)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.job.findMany).not.toHaveBeenCalled();
    expect(prisma.job.count).not.toHaveBeenCalled();
  });

  it('AND-combines groups with status and scopes disputes to unresolved records', () => {
    expect(
      adminJobWhere({
        group: AdminJobGroup.CANCELLED,
        status: JobStatus.FAILED,
      }).AND,
    ).toEqual([
      { status: 'FAILED' },
      { status: { in: ['CANCELLED', 'FAILED'] } },
    ]);
    expect(adminJobWhere({ group: AdminJobGroup.DISPUTED })).toEqual({
      AND: [{ dispute: { is: { resolvedAt: null } } }],
    });
  });

  it('preserves null assignees and custom service names in lightweight rows', () => {
    const row = adminJobListResponse({
      id: 'job-1',
      technician: null,
      serviceCategory: null,
      otherServiceName: 'Custom repair',
      locationAddress: 'Kigali',
      latitude: -1.9,
      longitude: 30,
    } as never);
    expect(row).toMatchObject({
      id: 'job-1',
      currentTechnician: null,
      service: 'Custom repair',
      location: { address: 'Kigali', latitude: -1.9, longitude: 30 },
    });
  });
});
