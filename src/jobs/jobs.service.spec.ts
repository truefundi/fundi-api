import {
  BookingPaymentStatus,
  JobDispatchStatus,
  JobCooperationStatus,
  JobOfferStatus,
  JobRequestType,
  JobStatus,
  JobWorkStatus,
  TechnicianAvailability,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { JOB_PIPELINE_STAGE_MAP, JobPipelineStage } from './job-pipeline';
import { JobsService } from './jobs.service';

describe('JobsService job reference', () => {
  it('formats the FD-MMYYNNN reference from the monthly counter', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ monthKey: '1126', lastNumber: 1 }])
        .mockResolvedValueOnce([{ monthKey: '1126', lastNumber: 42 }]),
    };
    const service = new JobsService(
      undefined as unknown as PrismaService,
      { require: jest.fn() } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );

    // The private helper is exercised directly: the SQL shape and formatting
    // are the contract, and the real allocation was verified against the DB.
    const nextJobReference = (
      service as unknown as {
        nextJobReference: (tx: unknown) => Promise<string>;
      }
    ).nextJobReference.bind(service);

    await expect(nextJobReference(tx)).resolves.toBe('FD-1126001');
    await expect(nextJobReference(tx)).resolves.toBe('FD-1126042');
  });
});

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
      { require: jest.fn() } as never,
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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

  it('lists offline technicians and companies when asked, with how to reach each', async () => {
    const categoryId = 'b6b1f0b4-2c55-4d5e-9b3c-0d6f6d7f4a11';
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        { technicianId: 'tech-offline', distanceMeters: 800, rejectionCount: 0, cancellationCount: 0 },
        { technicianId: 'tech-company', distanceMeters: 1_200, rejectionCount: 0, cancellationCount: 0 },
      ]),
      technicianProfile: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'tech-offline',
            gender: 'FEMALE',
            publicLocationLabel: 'Kacyiru',
            availabilityStatus: 'OFFLINE',
            businessType: 'INDIVIDUAL',
            company: null,
            user: { fullName: 'Offline Tech' },
            categories: [],
          },
          {
            id: 'tech-company',
            gender: 'MALE',
            publicLocationLabel: 'Remera',
            availabilityStatus: 'ONLINE',
            businessType: 'COMPANY',
            company: { id: 'company-1', name: 'Pipe Pros Ltd', verificationStatus: 'APPROVED' },
            user: { fullName: 'Company Owner' },
            categories: [],
          },
        ]),
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
      { require: jest.fn() } as never,
    );

    const matches = await service.previewMatchingTechnicians({
      serviceCategoryId: categoryId,
      latitude: -1.94,
      longitude: 30.06,
      includeOffline: true,
    });

    // The offline flag reaches the SQL filter.
    expect(
      (prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1),
    ).toContain(true);
    expect(matches).toEqual([
      expect.objectContaining({ technicianId: 'tech-offline', availabilityStatus: 'OFFLINE', company: null }),
      expect.objectContaining({
        technicianId: 'tech-company',
        availabilityStatus: 'ONLINE',
        company: { id: 'company-1', name: 'Pipe Pros Ltd' },
      }),
    ]);
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
      { require: jest.fn() } as never,
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
  it('confirms both sides at once when a price is agreed', async () => {
    const { service, tx, job, paymentUpdateMany, audit } =
      createConfirmationService();
    (tx.job as Record<string, jest.Mock>).findUnique = jest
      .fn()
      .mockImplementation(() => Promise.resolve(job));

    await expect(
      service.confirmCooperationForAgreement(tx as never, jobId, customerId),
    ).resolves.toBe(true);

    expect(job.cooperationStatus).toBe(JobCooperationStatus.CONFIRMED);
    expect(job.customerConfirmedAt).toBeInstanceOf(Date);
    expect(job.technicianConfirmedAt).toBeInstanceOf(Date);
    expect(paymentUpdateMany).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'JOB_COOPERATION_CONFIRMED',
        metadata: expect.objectContaining({ confirmedBy: 'price-agreement' }),
      }),
      tx,
    );

    await expect(
      service.confirmCooperationForAgreement(tx as never, jobId, customerId),
    ).resolves.toBe(false);
    expect(paymentUpdateMany).toHaveBeenCalledTimes(1);
  });

  it('refuses a price agreement once the technician is gone', async () => {
    const { service, tx, job } = createConfirmationService();
    job.technicianId = null as unknown as string;
    (job as { status: JobStatus }).status = JobStatus.OPEN;
    (tx.job as Record<string, jest.Mock>).findUnique = jest
      .fn()
      .mockResolvedValue(job);

    await expect(
      service.confirmCooperationForAgreement(tx as never, jobId, customerId),
    ).rejects.toThrow(
      'A price can only be agreed while a technician is assigned.',
    );
  });
});

describe('JobsService automatic re-routing', () => {
  it('routes the request to the best technician not yet asked', async () => {
    const prisma = {
      jobOffer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ technicianId: 'tech-declined' }]),
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
      undefined as never,
      undefined as never,
    );
    jest.spyOn(service as any, 'findJob').mockResolvedValue({
      id: 'job-1',
      customerId: 'customer-1',
      status: JobStatus.OPEN,
      technicianId: null,
      requestType: 'NORMAL',
      dispatchStatus: 'PENDING',
      serviceCategoryId: 'category-1',
      otherServiceName: null,
      latitude: -1.95,
      longitude: 30.06,
      customerHiddenAt: null,
    });
    jest.spyOn(service as any, 'findMatches').mockResolvedValue([
      { technicianId: 'tech-declined', matchScore: 100, distanceMeters: 10 },
      { technicianId: 'tech-next', matchScore: 90, distanceMeters: 20 },
    ]);
    const propose = jest
      .spyOn(service, 'proposeTechnician')
      .mockResolvedValue({ id: 'job-1' } as never);

    await service.retryDispatch('customer-1', 'job-1');

    expect(propose).toHaveBeenCalledWith('customer-1', 'job-1', {
      technicianId: 'tech-next',
    });
  });

  it('explains when every eligible technician has already been asked', async () => {
    const prisma = {
      jobOffer: {
        findMany: jest.fn().mockResolvedValue([{ technicianId: 'tech-1' }]),
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
      undefined as never,
      undefined as never,
    );
    jest.spyOn(service as any, 'findJob').mockResolvedValue({
      id: 'job-1',
      customerId: 'customer-1',
      status: JobStatus.OPEN,
      technicianId: null,
      requestType: 'NORMAL',
      dispatchStatus: 'PENDING',
      serviceCategoryId: 'category-1',
      otherServiceName: null,
      latitude: -1.95,
      longitude: 30.06,
      customerHiddenAt: null,
    });
    jest
      .spyOn(service as any, 'findMatches')
      .mockResolvedValue([
        { technicianId: 'tech-1', matchScore: 100, distanceMeters: 10 },
      ]);

    await expect(service.retryDispatch('customer-1', 'job-1')).rejects.toThrow(
      'No other technician is available',
    );
  });
});
