import {
  BookingPaymentStatus,
  JobCooperationStatus,
  JobStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from './jobs.service';

describe('JobsService location matching', () => {
  const categoryId = 'c5a4f4d7-0b21-46d8-9a4b-98765d332100';
  const profile = (id: string) => ({
    id,
    gender: 'FEMALE',
    user: { fullName: `Technician ${id}` },
    categories: [
      {
        categoryId,
        category: { id: categoryId, name: 'Plumbing', slug: 'plumbing' },
        customName: null,
        yearsOfExperience: 5,
      },
    ],
  });

  const createService = (
    textRows: Array<{
      id: string;
      rejectionCount: number;
      cancellationCount: number;
      baseAddress: string;
      publicLocationLabel: string | null;
    }>,
    geographicMatches: Array<{
      technicianId: string;
      distanceMeters: number;
      rejectionCount: number;
      cancellationCount: number;
    }> = [],
  ) => {
    const profiles = [
      ...textRows.map((row) => profile(row.id)),
      ...geographicMatches.map((row) => profile(row.technicianId)),
    ];
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      technicianProfile: {
        findMany: jest.fn().mockImplementation((args: { select?: unknown }) =>
          args.select ? Promise.resolve(textRows) : Promise.resolve(profiles),
        ),
      },
      $queryRaw: jest.fn().mockResolvedValue(geographicMatches),
    };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    return { service, prisma };
  };

  it('matches text-only technician locations without requiring coordinates', async () => {
    const { service, prisma } = createService([
      {
        id: 'text-only-technician',
        rejectionCount: 0,
        cancellationCount: 0,
        baseAddress: 'Kigali, Rwanda',
        publicLocationLabel: 'Kigali',
      },
    ]);

    await expect(
      service.previewMatchingTechniciansByLocationName({
        serviceCategoryId: categoryId,
        locations: ['Kigali'],
        latitude: null,
        longitude: null,
      }),
    ).resolves.toMatchObject([
      {
        technicianId: 'text-only-technician',
        matchAccuracy: 100,
        distanceMeters: null,
        matchedLocations: ['Kigali'],
      },
    ]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('combines text and geospatial candidates when both location inputs are provided', async () => {
    const { service, prisma } = createService(
      [
        {
          id: 'text-technician',
          rejectionCount: 0,
          cancellationCount: 0,
          baseAddress: 'Kigali, Rwanda',
          publicLocationLabel: 'Kigali',
        },
      ],
      [
        {
          technicianId: 'geo-technician',
          distanceMeters: 500,
          rejectionCount: 0,
          cancellationCount: 0,
        },
        {
          technicianId: 'text-technician',
          distanceMeters: 1000,
          rejectionCount: 0,
          cancellationCount: 0,
        },
      ],
    );

    await expect(
      service.previewMatchingTechniciansByLocationName({
        serviceCategoryId: categoryId,
        locations: ['Kigali'],
        latitude: -1.9536,
        longitude: 30.0606,
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          technicianId: 'text-technician',
          matchAccuracy: 100,
          distanceMeters: 1000,
          matchedLocations: ['Kigali'],
        }),
        expect.objectContaining({
          technicianId: 'geo-technician',
          distanceMeters: 500,
          matchedLocations: [],
        }),
      ]),
    );
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('supports coordinate-only matching through the location endpoint', async () => {
    const { service, prisma } = createService([], [
      {
        technicianId: 'geo-only-technician',
        distanceMeters: 500,
        rejectionCount: 0,
        cancellationCount: 0,
      },
    ]);

    await expect(
      service.previewMatchingTechniciansByLocationName({
        serviceCategoryId: categoryId,
        latitude: -1.9536,
        longitude: 30.0606,
      }),
    ).resolves.toMatchObject([
      {
        technicianId: 'geo-only-technician',
        distanceMeters: 500,
        matchedLocations: [],
      },
    ]);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('rejects a partial coordinate pair', async () => {
    const { service } = createService([]);

    await expect(
      service.previewMatchingTechniciansByLocationName({
        serviceCategoryId: categoryId,
        locations: ['Kigali'],
        latitude: -1.9536,
      }),
    ).rejects.toThrow('latitude and longitude must be provided together.');
  });
});

describe('JobsService cooperation confirmation', () => {
  const jobId = 'job-1';
  const customerId = 'customer-1';
  const technicianUserId = 'technician-user-1';
  const technicianProfileId = 'technician-profile-1';

  const createConfirmationService = () => {
    const job = {
      id: jobId,
      customerId,
      technicianId: technicianProfileId,
      status: JobStatus.ASSIGNED,
      cooperationStatus: JobCooperationStatus.PENDING,
      customerConfirmedAt: null as Date | null,
      technicianConfirmedAt: null as Date | null,
    };
    const paymentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      job: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(job)),
        update: jest.fn().mockImplementation(({ data }) => {
          Object.assign(job, data);
          return Promise.resolve(job);
        }),
      },
      bookingPayment: {
        findFirst: jest.fn().mockResolvedValue({ id: 'payment-1' }),
        updateMany: paymentUpdateMany,
      },
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: technicianProfileId }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as never,
      audit as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    jest.spyOn(service, 'getCustomerJob').mockResolvedValue({} as never);
    jest.spyOn(service, 'getTechnicianJob').mockResolvedValue({} as never);

    return { service, prisma, tx, job, paymentUpdateMany, audit };
  };

  it('expires the paused booking payment only after both participants confirm', async () => {
    const { service, tx, job, paymentUpdateMany, audit } =
      createConfirmationService();

    await service.confirmCooperation(customerId, jobId, 'customer');

    expect(job.cooperationStatus).toBe(JobCooperationStatus.PENDING);
    expect(job.customerConfirmedAt).toBeInstanceOf(Date);
    expect(job.technicianConfirmedAt).toBeNull();
    expect(paymentUpdateMany).not.toHaveBeenCalled();

    await service.confirmCooperation(technicianUserId, jobId, 'technician');

    expect(tx.job.update).toHaveBeenLastCalledWith({
      where: { id: jobId },
      data: expect.objectContaining({
        cooperationStatus: JobCooperationStatus.CONFIRMED,
        customerConfirmedAt: expect.any(Date),
        technicianConfirmedAt: expect.any(Date),
      }),
    });
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', status: BookingPaymentStatus.PAUSED },
      data: {
        status: BookingPaymentStatus.EXPIRED,
        validUntil: expect.any(Date),
        remainingValiditySeconds: 0,
      },
    });
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'JOB_COOPERATION_CONFIRMED',
        metadata: expect.objectContaining({ bookingPaymentExpired: true }),
      }),
      tx,
    );
  });

  it('does not expire payment when a participant repeats their confirmation', async () => {
    const { service, paymentUpdateMany } = createConfirmationService();

    await service.confirmCooperation(customerId, jobId, 'customer');
    await service.confirmCooperation(customerId, jobId, 'customer');

    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });
});

// Covers the dashboard counts: OPEN, ASSIGNED, and PAUSED jobs are active,
// COMPLETED is terminal, and a dispute counts as open until it is resolved.
describe('JobsService.summaryForAdmin', () => {
  const createService = () => {
    const jobCount = jest
      .fn()
      .mockImplementation((args: { where: { status: unknown } }) =>
        args.where.status === JobStatus.COMPLETED
          ? Promise.resolve(417)
          : Promise.resolve(23),
      );
    const disputeCount = jest.fn().mockResolvedValue(2);
    const prisma = {
      job: { count: jobCount },
      dispute: { count: disputeCount },
    };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
    );
    return { service, jobCount, disputeCount };
  };

  it('returns active, completed, and unresolved dispute counts', async () => {
    const { service } = createService();

    await expect(service.summaryForAdmin()).resolves.toEqual({
      active: 23,
      completed: 417,
      openDisputes: 2,
    });
  });

  it('counts active jobs as OPEN, ASSIGNED, or PAUSED and completed separately', async () => {
    const { service, jobCount, disputeCount } = createService();

    await service.summaryForAdmin();

    expect(jobCount).toHaveBeenCalledWith({
      where: {
        status: {
          in: [JobStatus.OPEN, JobStatus.ASSIGNED, JobStatus.PAUSED],
        },
      },
    });
    expect(jobCount).toHaveBeenCalledWith({
      where: { status: JobStatus.COMPLETED },
    });
    expect(disputeCount).toHaveBeenCalledWith({
      where: { resolvedAt: null },
    });
  });
});

describe('JobsService match scoring penalties', () => {
  it('leaves the score unchanged when the technician has no rejection or cancellation history', () => {
    expect(JobsService.adjustMatchScore(90, 0, 0)).toBe(90);
  });

  it('reduces match accuracy for rejected and cancelled jobs, capped at forty points', () => {
    expect(JobsService.adjustMatchScore(90, 2, 1)).toBe(75);
    expect(JobsService.adjustMatchScore(90, 20, 20)).toBe(50);
    expect(JobsService.adjustMatchScore(20, 20, 20)).toBe(0);
  });
});
