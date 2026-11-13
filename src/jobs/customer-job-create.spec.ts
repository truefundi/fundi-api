import { PrismaService } from '../database/prisma.service';
import { JobsService } from './jobs.service';

describe('JobsService customer job creation', () => {
  it('creates a customer job from a valid payment and phone verification', async () => {
    const jobCreate = jest.fn().mockResolvedValue(undefined);
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest
      .fn()
      .mockResolvedValue([{ monthKey: '1126', lastNumber: 1 }]);
    const paymentFindFirst = jest.fn().mockResolvedValue({
      id: 'payment-1',
      status: 'VALID',
      validUntil: new Date(Date.now() + 60_000),
      requestType: 'NORMAL',
    });
    const paymentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const verificationFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'verification-1' });
    const verificationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const categoryFindFirst = jest.fn().mockResolvedValue({ id: 'category-1' });
    const userFindUnique = jest.fn().mockResolvedValue({
      role: 'CUSTOMER',
      phoneVerifiedAt: null,
    });

    const tx = {
      job: { create: jobCreate },
      user: { findUnique: userFindUnique },
      bookingPayment: {
        findFirst: paymentFindFirst,
        update: jest.fn(),
        updateMany: paymentUpdateMany,
      },
      customerPhoneVerification: {
        findFirst: verificationFindFirst,
        updateMany: verificationUpdateMany,
      },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
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
      undefined as unknown as never,
    );

    jest.spyOn(service as any, 'findMatches').mockResolvedValue([]);

    const customerJob = {
      id: 'job-created',
      customerId: 'customer-1',
      status: 'OPEN',
    };
    const getCustomerJob = jest
      .spyOn(service, 'getCustomerJob')
      .mockResolvedValue(customerJob as any);

    const dto = {
      paymentId: 'payment-1',
      phoneVerificationId: 'verification-1',
      serviceCategoryId: 'category-1',
      description: 'The kitchen sink has been leaking since yesterday.',
      locationAddress: 'Kimironko, Gasabo',
      latitude: -1.9441,
      longitude: 30.0619,
      offeredAmount: 20_000,
    };

    await expect(service.create('customer-1', dto as any, [])).resolves.toBe(
      customerJob,
    );

    expect(categoryFindFirst).toHaveBeenCalledWith({
      where: { id: 'category-1', isActive: true },
      select: { id: true },
    });
    expect(jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'customer-1',
        reference: 'FD-1126001',
        serviceCategoryId: 'category-1',
        otherServiceName: null,
        phoneVerificationId: 'verification-1',
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
    expect(paymentUpdateMany).toHaveBeenCalledWith({
      where: { id: 'payment-1', customerId: 'customer-1', jobId: null },
      data: { jobId: expect.any(String) },
    });
    expect(verificationUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'verification-1',
        customerId: 'customer-1',
        consumedAt: null,
      }),
      data: { consumedAt: expect.any(Date) },
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'Job',
        action: 'JOB_CREATED',
        actorId: 'customer-1',
        toStatus: 'OPEN',
        metadata: expect.objectContaining({ reference: 'FD-1126001' }),
      }),
      tx,
    );
    expect(getCustomerJob).toHaveBeenCalledWith(
      'customer-1',
      expect.any(String),
    );
  });

  it('creates a later customer job without another phone verification', async () => {
    const jobCreate = jest.fn().mockResolvedValue(undefined);
    const executeRaw = jest.fn().mockResolvedValue(1);
    const queryRaw = jest
      .fn()
      .mockResolvedValue([{ monthKey: '1126', lastNumber: 2 }]);
    const paymentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const auditLog = jest.fn().mockResolvedValue(undefined);
    const userFindUnique = jest.fn().mockResolvedValue({
      role: 'CUSTOMER',
      phoneVerifiedAt: new Date(),
    });
    const verificationFindFirst = jest.fn();
    const tx = {
      job: { create: jobCreate },
      user: { findUnique: userFindUnique },
      bookingPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          status: 'VALID',
          validUntil: new Date(Date.now() + 60_000),
          requestType: 'NORMAL',
        }),
        update: jest.fn(),
        updateMany: paymentUpdateMany,
      },
      customerPhoneVerification: {
        findFirst: verificationFindFirst,
        updateMany: jest.fn(),
      },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    };
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-1' }),
      },
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
      undefined as unknown as never,
    );
    jest.spyOn(service as any, 'findMatches').mockResolvedValue([]);
    jest
      .spyOn(service, 'getCustomerJob')
      .mockResolvedValue({ id: 'job-created' } as any);

    await service.create(
      'customer-1',
      {
        paymentId: 'payment-1',
        serviceCategoryId: 'category-1',
        description: 'The kitchen sink has been leaking since yesterday.',
        locationAddress: 'Kimironko, Gasabo',
        latitude: -1.9441,
        longitude: 30.0619,
        offeredAmount: 20_000,
      } as any,
      [],
    );

    expect(verificationFindFirst).not.toHaveBeenCalled();
    expect(jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ phoneVerificationId: null }),
    });
  });
});
