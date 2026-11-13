import {
  BookingPaymentStatus,
  JobDispatchStatus,
  JobCooperationStatus,
  JobOfferStatus,
  JobRequestType,
  JobStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { JOB_PIPELINE_STAGE_MAP, JobPipelineStage } from './job-pipeline';
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
        findMany: jest
          .fn()
          .mockImplementation((args: { select?: unknown }) =>
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
    const { service, prisma } = createService(
      [],
      [
        {
          technicianId: 'geo-only-technician',
          distanceMeters: 500,
          rejectionCount: 0,
          cancellationCount: 0,
        },
      ],
    );

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

  it('returns similar-service technicians ranked by match accuracy for a job scenario', async () => {
    const job = {
      id: 'job-kigali-plumbing',
      serviceCategoryId: categoryId,
      serviceCategory: 'Plumbing',
      description: 'Repair a leaking kitchen sink and replace its tap.',
      locationAddress: 'Nyarutarama, Kigali',
      latitude: -1.9536,
      longitude: 30.0606,
    };
    const candidates = [
      {
        technicianId: 'tech-emmanuel',
        distanceMeters: 400,
        rejectionCount: 0,
        cancellationCount: 0,
      },
      {
        technicianId: 'tech-alice',
        distanceMeters: 5_000,
        rejectionCount: 0,
        cancellationCount: 0,
      },
      {
        technicianId: 'tech-patrick',
        distanceMeters: 10_000,
        rejectionCount: 1,
        cancellationCount: 0,
      },
    ];
    const profiles = [
      {
        id: 'tech-emmanuel',
        gender: 'MALE',
        publicLocationLabel: 'Nyarutarama',
        user: { fullName: 'Emmanuel Shyaka' },
        categories: [
          {
            categoryId,
            category: { id: categoryId, name: 'Plumbing', slug: 'plumbing' },
            customName: null,
            yearsOfExperience: 8,
          },
        ],
      },
      {
        id: 'tech-alice',
        gender: 'FEMALE',
        publicLocationLabel: 'Kimironko',
        user: { fullName: 'Alice Uwimana' },
        categories: [
          {
            categoryId,
            category: { id: categoryId, name: 'Plumbing', slug: 'plumbing' },
            customName: null,
            yearsOfExperience: 5,
          },
        ],
      },
      {
        id: 'tech-patrick',
        gender: 'MALE',
        publicLocationLabel: 'Kicukiro',
        user: { fullName: 'Patrick Niyonzima' },
        categories: [
          {
            categoryId,
            category: { id: categoryId, name: 'Plumbing', slug: 'plumbing' },
            customName: null,
            yearsOfExperience: 3,
          },
        ],
      },
      {
        id: 'tech-electrician',
        gender: 'MALE',
        publicLocationLabel: 'Kigali',
        user: { fullName: 'Jean de Dieu' },
        categories: [
          {
            categoryId: 'different-category',
            category: {
              id: 'different-category',
              name: 'Electrical',
              slug: 'electrical',
            },
            customName: null,
            yearsOfExperience: 7,
          },
        ],
      },
    ];
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue(candidates),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue(profiles),
      },
    };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: job.serviceCategoryId,
      latitude: job.latitude,
      longitude: job.longitude,
    });

    expect(matches).toEqual([
      expect.objectContaining({
        technicianId: 'tech-emmanuel',
        fullName: 'Emmanuel Shyaka',
        matchAccuracy: 100,
        distanceMeters: 400,
        serviceExperiences: [
          expect.objectContaining({
            category: { id: categoryId, name: 'Plumbing', slug: 'plumbing' },
            yearsOfExperience: 8,
          }),
        ],
      }),
      expect.objectContaining({
        technicianId: 'tech-alice',
        fullName: 'Alice Uwimana',
        matchAccuracy: 96,
        distanceMeters: 5_000,
      }),
      expect.objectContaining({
        technicianId: 'tech-patrick',
        fullName: 'Patrick Niyonzima',
        matchAccuracy: 87,
        distanceMeters: 10_000,
      }),
    ]);
    expect(matches.map((match) => match.technicianId)).not.toContain(
      'tech-electrician',
    );
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: {
            in: ['tech-emmanuel', 'tech-alice', 'tech-patrick'],
          },
        },
      }),
    );
  });

  it('ranks candidates using distance and incident counters, not job outcomes or ratings', async () => {
    const jobForMatching = {
      id: 'job-kigali-plumbing-follow-up',
      serviceCategoryId: categoryId,
      serviceName: 'Plumbing',
      description: 'Repair a leaking bathroom pipe.',
      locationAddress: 'Nyarutarama, Kigali',
      latitude: -1.9536,
      longitude: 30.0606,
    };
    const technicianScenarios: Array<{
      id: string;
      fullName: string;
      distanceMeters: number;
      jobs: Array<{
        status: string;
        ratingScores: number[] | null;
        cancellationRequestedBy?: string;
      }>;
      offers: Array<{ status: string }>;
      technicianCancellations: number;
    }> = [
      {
        id: 'tech-a-rated',
        fullName: 'Aline Uwase',
        distanceMeters: 1_000,
        jobs: [
          { status: 'COMPLETED', ratingScores: [5, 5, 5] },
          { status: 'COMPLETED', ratingScores: [5, 4, 5] },
        ],
        offers: [],
        technicianCancellations: 0,
      },
      {
        id: 'tech-b-unrated',
        fullName: 'Benoit Nkurunziza',
        distanceMeters: 5_000,
        jobs: [{ status: 'COMPLETED', ratingScores: null }],
        offers: [],
        technicianCancellations: 0,
      },
      {
        id: 'tech-c-rejected',
        fullName: 'Chantal Mukamana',
        distanceMeters: 1_000,
        jobs: [{ status: 'COMPLETED', ratingScores: [4, 4, 4] }],
        offers: [{ status: 'REJECTED' }],
        technicianCancellations: 0,
      },
      {
        id: 'tech-d-cancelled',
        fullName: 'Didier Habimana',
        distanceMeters: 1_000,
        jobs: [
          {
            status: 'CANCELLED',
            cancellationRequestedBy: 'TECHNICIAN',
            ratingScores: null,
          },
        ],
        offers: [],
        technicianCancellations: 1,
      },
      {
        id: 'tech-e-low-rated',
        fullName: 'Eric Rukundo',
        distanceMeters: 1_000,
        jobs: [
          { status: 'COMPLETED', ratingScores: [1, 1, 1] },
          { status: 'COMPLETED', ratingScores: [1, 2, 1] },
        ],
        offers: [],
        technicianCancellations: 0,
      },
    ];
    const queryRows = technicianScenarios.map((scenario) => ({
      technicianId: scenario.id,
      distanceMeters: scenario.distanceMeters,
      rejectionCount: scenario.offers.filter(
        (offer) => offer.status === 'REJECTED',
      ).length,
      cancellationCount: scenario.technicianCancellations,
    }));
    const profiles = technicianScenarios.map((scenario) => ({
      id: scenario.id,
      gender: 'MALE',
      publicLocationLabel: 'Kigali',
      user: { fullName: scenario.fullName },
      categories: [
        {
          categoryId,
          category: { id: categoryId, name: 'Plumbing', slug: 'plumbing' },
          customName: null,
          yearsOfExperience: 5,
        },
      ],
    }));
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue(queryRows),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue(profiles),
      },
    };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: jobForMatching.serviceCategoryId,
      latitude: jobForMatching.latitude,
      longitude: jobForMatching.longitude,
    });

    expect(
      matches.map(({ technicianId, matchAccuracy }) => [
        technicianId,
        matchAccuracy,
      ]),
    ).toEqual([
      ['tech-a-rated', 99],
      ['tech-e-low-rated', 99],
      ['tech-b-unrated', 96],
      ['tech-c-rejected', 94],
      ['tech-d-cancelled', 94],
    ]);
    expect(matches[0].serviceExperiences[0]).toMatchObject({
      category: { name: jobForMatching.serviceName },
    });
    expect(matches).toHaveLength(technicianScenarios.length);
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

describe('JobsService SOS technician dispatch', () => {
  it('offers the next best match and does not rotate to a technician already offered automatically', async () => {
    const job = {
      id: 'sos-job-1',
      customerId: 'customer-1',
      serviceCategoryId: 'category-1',
      otherServiceName: null,
      requestType: JobRequestType.SOS,
      status: JobStatus.OPEN,
      technicianId: null,
      dispatchStatus: JobDispatchStatus.EXHAUSTED,
      dispatchRound: 2,
      latitude: -1.95,
      longitude: 30.06,
      customerHiddenAt: null,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      job: {
        findUnique: jest.fn().mockResolvedValue(job),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue(job),
      },
      bookingPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          status: BookingPaymentStatus.RESUMED,
          validUntil: new Date(Date.now() + 60_000),
        }),
        update: jest.fn(),
      },
      jobOffer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ technicianId: 'previous-technician' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({
          id: 'offer-3',
          jobId: job.id,
          round: 3,
          matchScore: 90,
          distanceMeters: 500,
          expiresAt: new Date(Date.now() + 30_000),
          technician: { userId: 'technician-user-2' },
          job: {
            priority: 'NORMAL',
            description: 'Urgent plumbing repair needed.',
            locationAddress: 'Kigali',
            offeredAmount: 20_000,
            currency: 'RWF',
            otherServiceName: null,
            serviceCategory: { name: 'Plumbing' },
          },
        }),
      },
      technicianProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'next-technician',
          userId: 'technician-user-2',
        }),
      },
    };
    const prisma = {
      job: { findUnique: jest.fn().mockResolvedValue(job) },
      jobOffer: {},
      $queryRaw: jest.fn().mockResolvedValue([
        {
          technicianId: 'previous-technician',
          matchScore: 99,
          distanceMeters: 200,
          rejectionCount: 0,
          cancellationCount: 0,
        },
        {
          technicianId: 'next-technician',
          matchScore: 90,
          distanceMeters: 500,
          rejectionCount: 0,
          cancellationCount: 0,
        },
      ]),
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const events = { notifyTechnician: jest.fn() };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      events as never,
      undefined as never,
      queue as never,
      undefined as never,
    );
    jest.spyOn(service, 'getCustomerJob').mockResolvedValue({} as never);

    await service.retryDispatch('customer-1', job.id);

    expect(tx.technicianProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'next-technician' }),
      }),
    );
    expect(tx.jobOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          technicianId: 'next-technician',
          round: 3,
          status: 'OFFERED',
          expiresAt: expect.any(Date),
        }),
      }),
    );
    const offerData = tx.jobOffer.create.mock.calls[0][0].data as {
      expiresAt: Date;
    };
    const remainingOfferMs = offerData.expiresAt.getTime() - Date.now();
    expect(remainingOfferMs).toBeGreaterThan(0);
    expect(remainingOfferMs).toBeLessThanOrEqual(30_000);
    expect(queue.add).toHaveBeenCalledWith(
      'expire-offer',
      { offerId: 'offer-3' },
      expect.objectContaining({
        delay: expect.any(Number),
      }),
    );
    const expiryDelay = queue.add.mock.calls[0][2].delay as number;
    expect(expiryDelay).toBeGreaterThan(0);
    expect(expiryDelay).toBeLessThanOrEqual(30_000);
    expect(events.notifyTechnician).toHaveBeenCalledWith(
      'technician-user-2',
      'job:offer',
      expect.objectContaining({ requestType: JobRequestType.SOS }),
    );
  });
});

describe('JobsService normal technician requests', () => {
  const jobId = 'normal-job-1';
  const customerId = 'customer-1';
  const technicianId = 'technician-1';

  it('schedules a normal technician request to expire after two minutes', async () => {
    const now = new Date();
    const job = {
      id: jobId,
      customerId,
      customerHiddenAt: null,
      status: JobStatus.OPEN,
      technicianId: null,
      serviceCategoryId: 'category-1',
      otherServiceName: null,
      latitude: -1.95,
      longitude: 30.06,
      dispatchRound: 0,
      requestType: JobRequestType.NORMAL,
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      bookingPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          validUntil: new Date(now.getTime() + 60 * 60 * 1000),
        }),
        update: jest.fn(),
      },
      technicianProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: technicianId,
          userId: 'technician-user-1',
        }),
      },
      job: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      jobOffer: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'offer-1',
            jobId,
            ...data,
            technician: { userId: 'technician-user-1' },
            job: {
              priority: 'NORMAL',
              description: 'Repair a leaking pipe.',
              locationAddress: 'Kigali',
              offeredAmount: 20_000,
              currency: 'RWF',
              otherServiceName: null,
              serviceCategory: { name: 'Plumbing' },
            },
          }),
        ),
      },
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const events = { notifyTechnician: jest.fn() };
    const notifications = { create: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      job: { findUnique: jest.fn().mockResolvedValue(job) },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          technicianId,
          distanceMeters: 500,
          rejectionCount: 0,
          cancellationCount: 0,
        },
      ]),
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      events as never,
      notifications as never,
      queue as never,
      undefined as never,
    );
    jest.spyOn(service, 'getCustomerJob').mockResolvedValue({} as never);

    await service.proposeTechnician(customerId, jobId, {
      technicianId,
    });

    const offerData = tx.jobOffer.create.mock.calls[0][0].data as {
      expiresAt: Date;
    };
    expect(offerData.expiresAt.getTime() - Date.now()).toBeGreaterThan(119_000);
    expect(offerData.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      120_000,
    );
    expect(queue.add).toHaveBeenCalledWith(
      'expire-offer',
      { offerId: 'offer-1' },
      expect.objectContaining({ delay: 120_000 }),
    );
  });

  it('expires a normal offer and leaves the job open for the creator to choose again', async () => {
    const offer = {
      id: 'offer-expired',
      jobId,
      round: 2,
      status: JobOfferStatus.OFFERED,
      expiresAt: new Date(Date.now() - 1_000),
      job: { requestType: JobRequestType.NORMAL },
    };
    const tx = {
      jobOffer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      job: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      jobOffer: { findUnique: jest.fn().mockResolvedValue(offer) },
      job: { findUnique: jest.fn() },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    await service.expireOffer(offer.id);

    expect(tx.jobOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: offer.id,
          status: JobOfferStatus.OFFERED,
        }),
        data: { status: JobOfferStatus.EXPIRED, respondedAt: expect.any(Date) },
      }),
    );
    expect(tx.job.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: jobId,
          status: JobStatus.OPEN,
          technicianId: null,
          dispatchRound: offer.round,
        }),
        data: { dispatchStatus: JobDispatchStatus.PENDING },
      }),
    );
    expect(prisma.job.findUnique).not.toHaveBeenCalled();
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

describe('JobsService admin pipeline', () => {
  const createService = () => {
    const jobCount = jest.fn().mockResolvedValue(0);
    const jobFindMany = jest.fn().mockResolvedValue([]);
    const prisma = { job: { count: jobCount, findMany: jobFindMany } };
    const service = new JobsService(
      prisma as unknown as PrismaService,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
    );
    return { service, jobCount, jobFindMany };
  };

  it('counts tracked stages and leaves untracked stages null', async () => {
    const { service, jobCount } = createService();
    jobCount.mockResolvedValue(7);

    const result = await service.pipelineForAdmin();

    expect(jobCount).toHaveBeenCalledTimes(7);
    const counts = Object.fromEntries(
      result.stages.map((stage) => [stage.key, stage.count]),
    );
    expect(counts).toEqual({
      request: 7,
      match: 7,
      accept: 7,
      visit: 7,
      diagnose: null,
      quote: null,
      approve: null,
      repair: 7,
      settle: 7,
      rate: 7,
    });
    expect(result.stages.filter((stage) => !stage.tracked)).toHaveLength(3);
    expect(new Date(result.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('pages the jobs at a tracked stage using the admin include', async () => {
    const { service, jobCount, jobFindMany } = createService();
    jobCount.mockResolvedValue(21);

    const result = await service.pipelineStageForAdmin(JobPipelineStage.VISIT, {
      page: 2,
      limit: 10,
    });

    expect(result.stage).toMatchObject({
      key: JobPipelineStage.VISIT,
      tracked: true,
      count: 21,
    });
    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
    expect(jobCount).toHaveBeenCalledWith({
      where: JOB_PIPELINE_STAGE_MAP[JobPipelineStage.VISIT].where,
    });
    expect(jobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: JOB_PIPELINE_STAGE_MAP[JobPipelineStage.VISIT].where,
        skip: 10,
        take: 10,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('returns an empty page for an untracked stage without querying jobs', async () => {
    const { service, jobCount, jobFindMany } = createService();

    const result = await service.pipelineStageForAdmin(
      JobPipelineStage.DIAGNOSE,
    );

    expect(result.stage).toMatchObject({
      key: JobPipelineStage.DIAGNOSE,
      tracked: false,
      count: null,
    });
    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
    expect(jobCount).not.toHaveBeenCalled();
    expect(jobFindMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown stage', async () => {
    const { service } = createService();

    await expect(
      service.pipelineStageForAdmin('unknown' as JobPipelineStage),
    ).rejects.toThrow('Unknown job pipeline stage.');
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
