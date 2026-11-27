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
      job: { create: jobCreate, findFirst: jest.fn().mockResolvedValue(null) },
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
      { require: jest.fn() } as never,
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

  it('refuses to open the same request twice', async () => {
    const jobCreate = jest.fn();
    const paymentFindFirst = jest.fn();
    const jobFindFirst = jest
      .fn()
      .mockResolvedValue({ id: 'job-open', reference: 'FD-1126007' });
    const tx = {
      job: { create: jobCreate, findFirst: jobFindFirst },
      bookingPayment: { findFirst: paymentFindFirst },
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
      { log: jest.fn() } as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      { require: jest.fn() } as never,
      undefined as unknown as never,
    );
    jest.spyOn(service as any, 'findMatches').mockResolvedValue([]);

    const dto = {
      paymentId: 'payment-2',
      serviceCategoryId: 'category-1',
      description: '  The kitchen sink has been leaking since yesterday. ',
      locationAddress: 'kimironko, gasabo',
      latitude: -1.9441,
      longitude: 30.0619,
    };

    await expect(service.create('customer-1', dto as any, [])).rejects.toMatchObject({
      response: expect.objectContaining({ existingJobId: 'job-open' }),
    });
    expect(jobFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        customerId: 'customer-1',
        serviceCategoryId: 'category-1',
        status: { in: ['OPEN', 'ASSIGNED', 'PAUSED'] },
        description: {
          equals: 'The kitchen sink has been leaking since yesterday.',
          mode: 'insensitive',
        },
        locationAddress: { equals: 'kimironko, gasabo', mode: 'insensitive' },
      }),
      select: { id: true, reference: true },
    });
    expect(paymentFindFirst).not.toHaveBeenCalled();
    expect(jobCreate).not.toHaveBeenCalled();
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
      job: { create: jobCreate, findFirst: jest.fn().mockResolvedValue(null) },
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
      { require: jest.fn() } as never,
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

  it('accepts a verified account whose code expired while the payment was confirmed', async () => {
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
    // The code ran out while an admin checked the payment.
    const verificationFindFirst = jest.fn().mockResolvedValue(null);
    const tx = {
      job: { create: jobCreate, findFirst: jest.fn().mockResolvedValue(null) },
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
      { require: jest.fn() } as never,
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
        phoneVerificationId: 'expired-verification',
        serviceCategoryId: 'category-1',
        description: 'The kitchen sink has been leaking since yesterday.',
        locationAddress: 'Kimironko, Gasabo',
        latitude: -1.9441,
        longitude: 30.0619,
        offeredAmount: 20_000,
      } as any,
      [],
    );

    expect(verificationFindFirst).toHaveBeenCalled();
    expect(tx.customerPhoneVerification.updateMany).not.toHaveBeenCalled();
    expect(jobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ phoneVerificationId: null }),
    });
  });

  it('still requires a code when the account phone is not verified', async () => {
    const tx = {
      job: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
      user: {
        findUnique: jest.fn().mockResolvedValue({ phoneVerifiedAt: null }),
      },
      bookingPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment-1',
          status: 'VALID',
          validUntil: new Date(Date.now() + 60_000),
          requestType: 'NORMAL',
        }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      customerPhoneVerification: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $executeRaw: jest.fn(),
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
      { log: jest.fn() } as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never,
      undefined as unknown as never
    );
    jest.spyOn(service as any, 'findMatches').mockResolvedValue([]);

    await expect(
      service.create(
        'customer-1',
        {
          paymentId: 'payment-1',
          serviceCategoryId: 'category-1',
          description: 'The kitchen sink has been leaking since yesterday.',
          locationAddress: 'Kimironko, Gasabo',
          latitude: -1.9441,
          longitude: 30.0619,
        } as any,
        [],
      ),
    ).rejects.toThrow('Verify your phone number');
    expect(tx.job.create).not.toHaveBeenCalled();
  });
});
