import { DashboardCache } from './dashboard-cache';
import { AdminDashboardService } from './admin-dashboard.service';
import { DashboardPeriod } from './dto/dashboard-query.dto';

describe('Dashboard cache', () => {
  beforeEach(() =>
    jest.useFakeTimers().setSystemTime(new Date('2026-11-26T12:00:00Z')),
  );
  afterEach(() => jest.useRealTimers());

  it('shares four aggregates across concurrent overview and breakdown requests without stacking TTLs', async () => {
    const delegate = () => ({
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: 0 },
        _sum: {},
        _avg: { score: null },
      }),
    });
    const models: Record<string, ReturnType<typeof delegate>> = {};
    const prisma = new Proxy(models, {
      get: (target, model: string) =>
        target[model] ?? (target[model] = delegate()),
    });
    prisma.bookingPayment.groupBy.mockResolvedValue([
      {
        status: 'VALID',
        requestType: 'NORMAL',
        _count: { _all: 2 },
        _sum: { amount: 3000 },
      },
      {
        status: 'COMPLETED',
        requestType: 'SOS',
        _count: { _all: 1 },
        _sum: { amount: 5000 },
      },
    ]);
    const service = new AdminDashboardService(prisma as never);
    const query = { period: DashboardPeriod.CURRENT_MONTH, timezone: 'UTC' };
    const [overview] = await Promise.all([
      service.overview(query),
      service.breakdowns(query),
    ]);
    expect(overview.payments).toMatchObject({ count: 3, bookingAmount: 8000 });
    expect(prisma.user.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.technicianProfile.groupBy).toHaveBeenCalledTimes(2);
    expect(prisma.bookingPayment.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.bookingPayment.aggregate).not.toHaveBeenCalled();
    await Promise.all([service.overview(query), service.breakdowns(query)]);
    expect(prisma.bookingPayment.groupBy).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(15_000);
    await Promise.all([service.overview(query), service.breakdowns(query)]);
    expect(prisma.bookingPayment.groupBy).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent loads and expires after completion', async () => {
    const cache = new DashboardCache(100);
    const load = jest.fn().mockResolvedValue({ count: 3 });
    const [first, second] = await Promise.all([
      cache.get('key', load),
      cache.get('key', load),
    ]);
    expect(first).toEqual(second);
    expect(load).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(99);
    await cache.get('key', load);
    expect(load).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await cache.get('key', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures and bounds retained keys', async () => {
    const cache = new DashboardCache(100, 2);
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('DB unavailable'))
      .mockResolvedValue(1);
    await expect(cache.get('a', load)).rejects.toThrow('DB unavailable');
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('c', load);
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('does not let a cleared pending request replace or remove a newer entry', async () => {
    const cache = new DashboardCache();
    let reject!: (error: Error) => void;
    const pending = cache.get(
      'a',
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    const observed = expect(pending).rejects.toThrow('old');
    await Promise.resolve();
    cache.clear();
    const fresh = jest.fn().mockResolvedValue(2);
    await cache.get('a', fresh);
    reject(new Error('old'));
    await observed;
    expect(await cache.get('a', fresh)).toBe(2);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('keys analytics by all filters and resolved period, and invalidates on observed audit events', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      auditLog: {
        findMany: jest.fn().mockResolvedValue([{ id: 'event', actorId: null }]),
      },
    };
    const service = new AdminDashboardService(prisma as never);
    const query = { timezone: 'UTC', period: DashboardPeriod.TODAY };
    await Promise.all([
      service.trends(query),
      service.trends({ period: DashboardPeriod.TODAY, timezone: 'UTC' }),
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(9);
    await service.trends({ ...query, customerId: 'another-customer' });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(18);
    await service.activityAfter({ createdAt: new Date(), id: '' });
    await service.trends(query);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(27);
    jest.setSystemTime(new Date('2026-11-26T23:59:59Z'));
    await service.trends(query);
    jest.setSystemTime(new Date('2026-11-27T00:00:01Z'));
    await service.trends(query);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(45);
  });
});
