import { PrismaService } from '../database/prisma.service';
import { JobsService } from './jobs.service';

describe('JobsService customer job creation', () => {
  it('creates a customer job, creates an offer for a matching technician, and dispatches it', async () => {
    const jobCreate = jest.fn().mockResolvedValue(undefined);
    const executeRaw = jest.fn().mockResolvedValue(1);
    const createOffers = jest.fn().mockResolvedValue(undefined);
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const categoryFindFirst = jest.fn().mockResolvedValue({ id: 'category-1' });

    const tx = {
      job: { create: jobCreate },
      jobOffer: { createMany: createOffers },
      $executeRaw: executeRaw,
    };
    const prisma = {
      serviceCategory: { findFirst: categoryFindFirst },
      $transaction: jest
        .fn()
        .mockImplementation(async (operation: (client: typeof tx) => unknown) =>
          operation(tx),
        ),
    };

    const service = new JobsService(
      prisma as unknown as PrismaService,
      { put: jest.fn(), delete: jest.fn() } as unknown as never,
      { log: auditLog } as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
    );

    const candidate = {
      technicianId: 'technician-1',
      matchScore: 90,
      distanceMeters: 250,
    };
    jest.spyOn(service as any, 'findMatches').mockResolvedValue([candidate]);
    const dispatchNext = jest
      .spyOn(service as any, 'dispatchNext')
      .mockResolvedValue(undefined);

    const customerJob = {
      id: 'job-created',
      customerId: 'customer-1',
      status: 'OPEN',
    };
    const getCustomerJob = jest
      .spyOn(service, 'getCustomerJob')
      .mockResolvedValue(customerJob as any);

    const dto = {
      serviceCategoryId: 'category-1',
      description: 'The kitchen sink has been leaking since yesterday.',
      locationAddress: 'Kimironko, Gasabo',
      latitude: -1.9441,
      longitude: 30.0619,
      offeredAmount: 20_000,
    };

    await expect(
      service.create('customer-1', dto as any, []),
    ).resolves.toBe(customerJob);

    expect(categoryFindFirst).toHaveBeenCalledWith({
      where: { id: 'category-1', isActive: true },
      select: { id: true },
    });
    expect(jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'customer-1',
        serviceCategoryId: 'category-1',
        otherServiceName: null,
        description: dto.description,
        locationAddress: dto.locationAddress,
        latitude: dto.latitude,
        longitude: dto.longitude,
        offeredAmount: dto.offeredAmount,
        priority: 'NORMAL',
        dispatchStatus: 'PENDING',
      }),
    });
    expect(executeRaw).toHaveBeenCalled();
    expect(createOffers).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          jobId: expect.any(String),
          technicianId: candidate.technicianId,
          round: 1,
          matchScore: candidate.matchScore,
          distanceMeters: candidate.distanceMeters,
          status: 'WAITING',
        }),
      ],
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Job',
        action: 'JOB_CREATED',
        actorId: 'customer-1',
        toStatus: 'OPEN',
      }),
      tx,
    );
    expect(dispatchNext).toHaveBeenCalledWith(expect.any(String));
    expect(getCustomerJob).toHaveBeenCalledWith(
      'customer-1',
      expect.any(String),
    );
  });
});
