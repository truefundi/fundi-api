import { BadRequestException } from '@nestjs/common';
import { BookingPaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';
import {
  adminPaymentWhere,
  effectivePaymentStatus,
  paymentStatusWhere,
} from './admin-payment-list';
import { AdminPaymentSort } from './dto/list-admin-payments-query.dto';
import { SortOrder } from '../common/dto/admin-list-query.dto';

describe('Admin payment pagination and summaries', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  function setup() {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
      bookingPayment: {
        count: jest.fn().mockResolvedValue(31),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    const service = new PaymentsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { prisma, service };
  }

  it('paginates with shared filters and safe fields, without expiring payments in storage', async () => {
    const { service, prisma } = setup();
    const query = {
      page: 2,
      limit: 10,
      status: BookingPaymentStatus.EXPIRED,
      search: 'customer',
      sortBy: AdminPaymentSort.AMOUNT,
      sortOrder: SortOrder.ASC,
    };
    const result = await service.listPageForAdmin(query);
    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 31,
      totalPages: 4,
    });
    const args = prisma.bookingPayment.findMany.mock.calls[0][0];
    expect(args).toMatchObject({
      skip: 10,
      take: 10,
      orderBy: [{ amount: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.bookingPayment.count).toHaveBeenCalledWith({
      where: args.where,
    });
    expect(args.select).not.toHaveProperty('signature');
    expect(args.select).not.toHaveProperty('paymentKeyId');
    expect(args.select).not.toHaveProperty('pricingSnapshot');
    expect(args.select.job.select).not.toHaveProperty('assignmentHistory');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.bookingPayment.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['VALID', 'EXPIRED'],
    ['RESUMED', 'EXPIRED'],
    ['PAUSED', 'PAUSED'],
    ['COMPLETED', 'COMPLETED'],
    ['EXPIRED', 'EXPIRED'],
  ] as const)(
    'displays effective %s status at the exact expiry boundary as %s',
    (status, expected) => {
      expect(effectivePaymentStatus({ status, validUntil: now }, now)).toBe(
        expected,
      );
    },
  );

  it('loads at most one assignment per linked job in one parameterized SQL query', async () => {
    const { service, prisma } = setup();
    prisma.bookingPayment.findMany.mockResolvedValue([
      {
        id: 'payment-1',
        status: 'VALID',
        validUntil: new Date(now.getTime() + 1000),
        job: { id: 'job-1' },
      },
      {
        id: 'payment-2',
        status: 'COMPLETED',
        validUntil: now,
        job: { id: 'job-2' },
      },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { jobId: 'job-1', technicianName: 'Latest technician' },
    ]);
    const result = await service.listPageForAdmin({ page: 1 });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql, values] = prisma.$queryRaw.mock.calls[0];
    // Tagged-template arguments retain job IDs as bindings, not SQL text.
    expect(sql.join(' ')).toContain('JOIN LATERAL');
    expect(sql.join(' ')).toContain('LIMIT 1');
    expect(values.values).toEqual(['job-1', 'job-2']);
    expect(result.data[0].job?.assignmentHistory).toEqual([
      { technicianName: 'Latest technician' },
    ]);
    expect(result.data[1].job?.assignmentHistory).toEqual([]);
  });

  it('keeps VALID and RESUMED filters exclusive of overdue records', () => {
    expect(paymentStatusWhere(BookingPaymentStatus.VALID, now)).toEqual({
      status: 'VALID',
      validUntil: { gt: now },
    });
    expect(paymentStatusWhere(BookingPaymentStatus.EXPIRED, now)).toEqual({
      OR: [
        { status: 'EXPIRED' },
        { status: { in: ['VALID', 'RESUMED'] }, validUntil: { lte: now } },
      ],
    });
  });

  it('uses inclusive/exclusive paidAt dates and rejects reversed ranges before querying', async () => {
    const { service, prisma } = setup();
    const from = '2026-11-01T00:00:00Z';
    const to = '2026-12-01T00:00:00Z';
    expect(adminPaymentWhere({ from, to }, now)).toEqual({
      paidAt: { gte: new Date(from), lt: new Date(to) },
    });
    await expect(
      service.listPageForAdmin({ from: to, to: from }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.bookingPayment.findMany).not.toHaveBeenCalled();
  });

  it('moves overdue totals into EXPIRED without changing the grand total or loading payment rows', async () => {
    const { service, prisma } = setup();
    const group = (
      status: BookingPaymentStatus,
      count: number,
      amount: number | null,
    ) => ({ status, _count: { _all: count }, _sum: { amount } });
    prisma.bookingPayment.groupBy
      .mockResolvedValueOnce([
        group('VALID', 3, 3000),
        group('RESUMED', 1, 2000),
        group('EXPIRED', 1, 500),
        group('COMPLETED', 1, 4000),
      ])
      .mockResolvedValueOnce([
        group('VALID', 2, 2000),
        group('RESUMED', 1, 2000),
      ]);
    const result = await service.summaryForAdmin({
      search: 'Plumbing',
      page: 3,
    });
    expect(result).toMatchObject({
      total: 6,
      amount: 9500,
      currency: 'RWF',
      generatedAt: now.toISOString(),
    });
    expect(result.byStatus).toEqual(
      expect.arrayContaining([
        { status: 'VALID', count: 1, amount: 1000 },
        { status: 'RESUMED', count: 0, amount: 0 },
        { status: 'EXPIRED', count: 4, amount: 4500 },
        { status: 'PAUSED', count: 0, amount: 0 },
      ]),
    );
    expect(prisma.bookingPayment.findMany).not.toHaveBeenCalled();
    expect(prisma.bookingPayment.updateMany).not.toHaveBeenCalled();
    expect(prisma.bookingPayment.groupBy).toHaveBeenCalledTimes(2);
  });

  it('returns zero totals for an empty filtered collection', async () => {
    const { service, prisma } = setup();
    prisma.bookingPayment.groupBy.mockResolvedValue([]);
    expect(await service.summaryForAdmin()).toMatchObject({
      total: 0,
      amount: 0,
    });
  });
});
