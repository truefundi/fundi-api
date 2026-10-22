import { JobStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from './jobs.service';

// Covers the dashboard counts: only OPEN and ASSIGNED jobs are active, COMPLETED
// is terminal, and disputes are not modelled yet so the count is null.
describe('JobsService.summaryForAdmin', () => {
  const createService = () => {
    const jobCount = jest
      .fn()
      .mockImplementation((args: { where: { status: unknown } }) =>
        args.where.status === JobStatus.COMPLETED
          ? Promise.resolve(417)
          : Promise.resolve(23),
      );
    const prisma = { job: { count: jobCount } };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
    );
    return { service, jobCount };
  };

  it('returns active, completed, and a null dispute count', async () => {
    const { service } = createService();

    await expect(service.summaryForAdmin()).resolves.toEqual({
      active: 23,
      completed: 417,
      openDisputes: null,
    });
  });

  it('counts active jobs as OPEN or ASSIGNED and completed jobs separately', async () => {
    const { service, jobCount } = createService();

    await service.summaryForAdmin();

    expect(jobCount).toHaveBeenCalledWith({
      where: { status: { in: [JobStatus.OPEN, JobStatus.ASSIGNED] } },
    });
    expect(jobCount).toHaveBeenCalledWith({
      where: { status: JobStatus.COMPLETED },
    });
  });
});

describe('JobsService single-match retention rule', () => {
  it('keeps the only eligible technician when the queue contains a single match', () => {
    expect(JobsService.shouldRetainSingleMatchOffer(1)).toBe(true);
    expect(JobsService.selectOfferForDispatch([{ id: 'offer-1' }])).toEqual({
      id: 'offer-1',
    });
  });

  it('still selects the highest-ranked technician when multiple eligible technicians remain', () => {
    const offers = [
      { id: 'offer-2', matchScore: 60 },
      { id: 'offer-1', matchScore: 90 },
    ];

    expect(JobsService.shouldRetainSingleMatchOffer(2)).toBe(false);
    expect(JobsService.selectOfferForDispatch(offers)).toEqual({
      id: 'offer-2',
      matchScore: 60,
    });
  });
});
