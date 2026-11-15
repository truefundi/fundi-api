import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardPeriod } from './dto/dashboard-query.dto';

describe('AdminDashboardService', () => {
  it('returns trend series for all supported domains and rounds averages', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          bucket: '2025-01-01T00:00:00',
          count: 2,
          amount: 125,
          average: 4.126,
        },
      ]),
    };
    const service = new AdminDashboardService(
      prisma as unknown as PrismaService,
    );

    const response = await service.trends({
      period: DashboardPeriod.SELECTED_MONTH,
      month: '2025-01',
      timezone: 'UTC',
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(9);
    expect(response.series).toEqual(
      expect.arrayContaining([
        {
          domain: 'users',
          metric: 'new',
          data: [{ bucket: '2025-01-01T00:00:00', value: 2 }],
        },
        {
          domain: 'payments',
          metric: 'count',
          data: [{ bucket: '2025-01-01T00:00:00', value: 2 }],
        },
        {
          domain: 'payments',
          metric: 'bookingAmount',
          data: [{ bucket: '2025-01-01T00:00:00', value: 125 }],
        },
        {
          domain: 'ratings',
          metric: 'averageScore',
          data: [{ bucket: '2025-01-01T00:00:00', value: 4.13 }],
        },
        {
          domain: 'catalog',
          metric: 'categoriesCreated',
          data: [{ bucket: '2025-01-01T00:00:00', value: 2 }],
        },
        {
          domain: 'catalog',
          metric: 'servicesCreated',
          data: [{ bucket: '2025-01-01T00:00:00', value: 2 }],
        },
      ]),
    );
    expect(response.range).toMatchObject({
      period: DashboardPeriod.SELECTED_MONTH,
      timezone: 'UTC',
      toExclusive: true,
    });
  });

  it('includes current and period catalog totals in the overview', async () => {
    const activeCount = { isActive: true, _count: { _all: 4 } };
    const inactiveCount = { isActive: false, _count: { _all: 2 } };
    const prisma = {
      user: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      technicianProfile: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      job: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      bookingPayment: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      dispute: { count: jest.fn().mockResolvedValue(0) },
      chatMessage: { count: jest.fn().mockResolvedValue(0) },
      chatRoom: { count: jest.fn().mockResolvedValue(0) },
      jobRating: { count: jest.fn().mockResolvedValue(0) },
      ratingResponse: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _avg: { score: null },
        }),
      },
      broadcast: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: {
            userCount: null,
            smsSentCount: null,
            smsFailedCount: null,
            inAppSentCount: null,
          },
        }),
      },
      notification: { count: jest.fn().mockResolvedValue(0) },
      conversation: { groupBy: jest.fn().mockResolvedValue([]) },
      technicianDocument: { groupBy: jest.fn().mockResolvedValue([]) },
      jobCancellationRequest: { groupBy: jest.fn().mockResolvedValue([]) },
      jobOffer: { groupBy: jest.fn().mockResolvedValue([]) },
      ad: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: { impressions: null, clicks: null },
        }),
      },
      auditLog: { count: jest.fn().mockResolvedValue(0) },
      passkeyCredential: { count: jest.fn().mockResolvedValue(0) },
      catalogCategory: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([activeCount])
          .mockResolvedValueOnce([activeCount, inactiveCount]),
      },
      serviceCategory: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([inactiveCount])
          .mockResolvedValueOnce([activeCount, inactiveCount]),
      },
    };
    const service = new AdminDashboardService(
      prisma as unknown as PrismaService,
    );

    const response = await service.overview({
      period: DashboardPeriod.CURRENT_MONTH,
      timezone: 'UTC',
    });

    expect(response.catalog).toEqual({
      newCategories: [{ isActive: true, count: 4 }],
      newServices: [{ isActive: false, count: 2 }],
      currentCategories: [
        { isActive: true, count: 4 },
        { isActive: false, count: 2 },
      ],
      currentServices: [
        { isActive: true, count: 4 },
        { isActive: false, count: 2 },
      ],
    });
  });

  it('breaks down services by catalog category and active state', async () => {
    const catalogCategory = {
      id: 'catalog-category-id',
      name: 'Home services',
      description: 'Household services',
    };
    const prisma = new Proxy(
      {},
      {
        get: (_target, model: string) => {
          if (model === 'catalogCategory') {
            return {
              groupBy: jest
                .fn()
                .mockResolvedValue([{ isActive: true, _count: { _all: 1 } }]),
              findMany: jest.fn().mockResolvedValue([catalogCategory]),
            };
          }
          if (model === 'serviceCategory') {
            return {
              groupBy: jest.fn().mockResolvedValue([
                {
                  categoryId: catalogCategory.id,
                  isActive: true,
                  _count: { _all: 3 },
                },
              ]),
              findMany: jest.fn().mockResolvedValue([]),
            };
          }
          return {
            groupBy: jest.fn().mockResolvedValue([]),
          };
        },
      },
    );
    const service = new AdminDashboardService(
      prisma as unknown as PrismaService,
    );

    const response = await service.breakdowns({
      period: DashboardPeriod.CURRENT_MONTH,
      timezone: 'UTC',
    });

    expect(response.catalog).toEqual({
      categoriesByStatus: [{ isActive: true, count: 1 }],
      servicesByCategoryAndStatus: [
        {
          category: catalogCategory,
          isActive: true,
          count: 3,
        },
      ],
    });
  });

  it('includes technician status dimensions in dashboard breakdowns', async () => {
    const prisma = new Proxy(
      {},
      {
        get: (_target, model: string) => {
          if (model === 'technicianProfile') {
            return {
              groupBy: jest.fn(({ by }: { by: string[] }) =>
                Promise.resolve(
                  by[0] === 'verificationStatus'
                    ? [
                        {
                          verificationStatus: 'APPROVED',
                          _count: { _all: 7 },
                        },
                        {
                          verificationStatus: 'PENDING',
                          _count: { _all: 6 },
                        },
                      ]
                    : [
                        {
                          availabilityStatus: 'ONLINE',
                          _count: { _all: 4 },
                        },
                        {
                          availabilityStatus: 'OFFLINE',
                          _count: { _all: 9 },
                        },
                      ],
                ),
              ),
            };
          }
          return {
            groupBy: jest.fn().mockResolvedValue([]),
            findMany: jest.fn().mockResolvedValue([]),
          };
        },
      },
    );
    const service = new AdminDashboardService(
      prisma as unknown as PrismaService,
    );

    const response = await service.breakdowns({
      period: DashboardPeriod.CURRENT_MONTH,
      timezone: 'UTC',
    });

    expect(response.technicians).toEqual({
      verificationStatus: [
        { verificationStatus: 'APPROVED', count: 7 },
        { verificationStatus: 'PENDING', count: 6 },
      ],
      availabilityStatus: [
        { availabilityStatus: 'ONLINE', count: 4 },
        { availabilityStatus: 'OFFLINE', count: 9 },
      ],
    });
  });

  it('returns ranked technician rows with rounded rating averages', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'technician-id',
          fullName: 'Sample Technician',
          verificationStatus: 'APPROVED',
          availabilityStatus: 'ONLINE',
          completedJobs: 4,
          ratingCount: 2,
          averageRating: 4.256,
        },
      ]),
    };
    const service = new AdminDashboardService(
      prisma as unknown as PrismaService,
    );

    const response = await service.topTechnicians({
      period: DashboardPeriod.CURRENT_YEAR,
      timezone: 'UTC',
    });

    expect(response.data).toEqual([
      {
        rank: 1,
        technicianId: 'technician-id',
        fullName: 'Sample Technician',
        verificationStatus: 'APPROVED',
        availabilityStatus: 'ONLINE',
        completedJobs: 4,
        ratingCount: 2,
        averageRating: 4.26,
      },
    ]);
  });

  it('separates period counts from current technician and dispute snapshots', async () => {
    const prisma = {
      user: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      technicianProfile: {
        count: jest.fn().mockResolvedValue(3),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      job: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      bookingPayment: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      dispute: {
        count: jest.fn().mockResolvedValue(0),
      },
      chatMessage: { count: jest.fn().mockResolvedValue(0) },
      chatRoom: { count: jest.fn().mockResolvedValue(0) },
      jobRating: { count: jest.fn().mockResolvedValue(0) },
      ratingResponse: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _avg: { score: null },
        }),
      },
      broadcast: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: {
            userCount: null,
            smsSentCount: null,
            smsFailedCount: null,
            inAppSentCount: null,
          },
        }),
      },
      notification: { count: jest.fn().mockResolvedValue(0) },
      conversation: { groupBy: jest.fn().mockResolvedValue([]) },
      technicianDocument: { groupBy: jest.fn().mockResolvedValue([]) },
      jobCancellationRequest: { groupBy: jest.fn().mockResolvedValue([]) },
      jobOffer: { groupBy: jest.fn().mockResolvedValue([]) },
      ad: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 0 },
          _sum: { impressions: null, clicks: null },
        }),
      },
      auditLog: { count: jest.fn().mockResolvedValue(0) },
      passkeyCredential: { count: jest.fn().mockResolvedValue(0) },
      catalogCategory: { groupBy: jest.fn().mockResolvedValue([]) },
      serviceCategory: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const service = new AdminDashboardService(
      prisma as unknown as PrismaService,
    );

    await service.overview({
      period: DashboardPeriod.CURRENT_MONTH,
      timezone: 'UTC',
    });

    const [newProfilesQuery] = prisma.technicianProfile.count.mock.calls[0];
    expect(newProfilesQuery.where.createdAt).toBeDefined();
    expect(
      prisma.technicianProfile.groupBy.mock.calls[0][0].where.createdAt,
    ).toBeUndefined();
    expect(prisma.dispute.count.mock.calls[0][0].where.openedAt).toBeDefined();
    expect(
      prisma.dispute.count.mock.calls[1][0].where.openedAt,
    ).toBeUndefined();
    expect(prisma.dispute.count.mock.calls[1][0].where.resolvedAt).toBeNull();
  });

  it('validates activity stream cursors and accepts a valid cursor', () => {
    const service = new AdminDashboardService({} as PrismaService);
    const eventId = Buffer.from(
      JSON.stringify({
        createdAt: '2025-01-01T00:00:00.000Z',
        id: 'audit-row-id',
      }),
    ).toString('base64url');

    expect(service.activityEvents(eventId)).toEqual({
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      id: 'audit-row-id',
    });
    expect(() => service.activityEvents('invalid')).toThrow(
      BadRequestException,
    );
  });

  it('requires an administrator session role on dashboard routes', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminDashboardController)).toEqual([
      'ADMIN',
    ]);
  });
});
