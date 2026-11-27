import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  JobRequestType,
  PaymentClaimMethod,
  PaymentClaimStatus,
  ServiceChargePayer,
  ServiceChargeType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from './payments.service';
import { PaymentProvidersService } from './payment-providers.service';
import { PaymentEventsService } from './payment-events.service';

describe('PaymentsService mock booking payments', () => {
  const fixedNow = new Date('2026-10-28T12:00:00.000Z');

  const createService = (
    visitFee: number | null = 1000,
    configured = true,
    environment = 'development',
  ) => {
    const serviceCharges: Array<{
      id: string;
      name: string;
      description: string | null;
      chargeType: ServiceChargeType;
      value: number;
      payer: ServiceChargePayer;
      sortOrder: number;
    }> = [];
    const category = {
      id: 'category-1',
      name: 'Plumbing',
      slug: 'plumbing',
      visitFee,
      sosBookingFee: visitFee === null ? null : visitFee * 2,
      serviceCharges,
    };
    const paymentCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    );
    const claimCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'claim-1',
        ...data,
        status: PaymentClaimStatus.PENDING,
        reviewNote: null,
        reviewedById: null,
        reviewedAt: null,
        bookingPaymentId: null,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        customer: {
          id: 'customer-1',
          fullName: 'Customer One',
          phoneNumber: '+250788123456',
        },
        serviceCategory: {
          id: category.id,
          name: category.name,
          slug: category.slug,
        },
        reviewedBy: null,
        bookingPayment: null,
      }),
    );
    const claimUpdate = jest.fn();
    const claimFindUnique = jest.fn();
    const claimFindMany = jest.fn().mockResolvedValue([]);
    const claimDelete = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      bookingPayment: { create: paymentCreate },
      paymentClaim: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: claimCreate,
        findMany: claimFindMany,
        findUnique: claimFindUnique,
        update: claimUpdate,
        delete: claimDelete,
      },
    };
    const prisma = {
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue(category),
      },
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ phoneNumber: '+250788123456' }),
      },
      paymentClaim: tx.paymentClaim,
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const config = {
      get: jest.fn((key: string) => {
        if (!configured) return undefined;
        if (key === 'environment') return environment;
        return key === 'mockPayment.key' ? 'mock-key' : 'mock-secret';
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const providers = {
      assertSimulationAvailable: jest.fn(() => {
        if (environment === 'production')
          throw new ServiceUnavailableException();
      }),
      assertMode: jest.fn().mockResolvedValue(undefined),
    };
    const events = {
      claimCreated: jest.fn().mockResolvedValue(undefined),
      claimReviewed: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
      providers as unknown as PaymentProvidersService,
      events as unknown as PaymentEventsService,
    );
    return {
      service,
      prisma,
      paymentCreate,
      claimCreate,
      claimUpdate,
      claimFindUnique,
      claimFindMany,
      claimDelete,
      audit,
      tx,
      providers,
      events,
    };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(fixedNow);
  });

  it('looks a service up by id when the client sends its UUID', async () => {
    const { service, prisma } = createService();
    const serviceId = 'b1785204-f59a-4cc3-a9f9-94932e4a6d30';

    await service.createMockPayment('customer-1', {
      serviceCategoryId: serviceId,
    });

    expect(prisma.serviceCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          category: { isActive: true },
          id: serviceId,
        },
      }),
    );
  });

  it('charges the service category SOS fee and records the request type', async () => {
    const { service, paymentCreate, prisma } = createService();

    const payment = await service.createMockPayment('customer-1', {
      serviceCategoryId: 'category-1',
      requestType: JobRequestType.SOS,
    });

    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 2000,
          requestType: JobRequestType.SOS,
        }),
      }),
    );
    expect(payment).toMatchObject({
      amount: 2000,
      requestType: JobRequestType.SOS,
    });
    // Not a UUID, so it is matched as a slug or display name (mobile clients send either).
    expect(prisma.serviceCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          category: { isActive: true },
          OR: [
            { slug: 'category-1' },
            { name: { equals: 'category-1', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('does not allow extending a payment after cooperation confirmation', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      bookingPayment: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'payment-1',
          jobId: 'job-1',
          job: { cooperationStatus: 'CONFIRMED' },
        }),
        update: jest.fn(),
      },
    };
    const prisma = {
      bookingPayment: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'payment-1', jobId: 'job-1' }),
      },
      $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      { get: jest.fn() } as unknown as ConfigService,
      { log: jest.fn() } as unknown as AuditService,
      {} as PaymentProvidersService,
      {} as PaymentEventsService,
    );

    await expect(
      service.extend('payment-1', { days: 7 }, 'admin-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.bookingPayment.update).not.toHaveBeenCalled();
  });

  describe('PaymentsService completed-job payment administration', () => {
    const createAdminService = (
      overrides: {
        job?: Record<string, unknown> | null;
        payment?: Record<string, unknown> | null;
      } = {},
    ) => {
      const job = overrides.job ?? {
        id: 'job-1',
        customerId: 'customer-1',
        status: 'COMPLETED',
        serviceCategory: {
          id: 'category-1',
          name: 'Plumbing',
          visitFee: 1000,
          sosBookingFee: 2000,
          serviceCharges: [],
        },
        bookingPayment: null,
      };
      const existingPayment = overrides.payment ?? {
        id: 'payment-1',
        customerId: 'customer-1',
        serviceCategoryId: 'category-1',
        jobId: 'job-1',
        externalPaymentId: 'provider-ref-001',
        paymentKeyId: 'admin-reconciled',
        signature: 'private-signature',
        phoneNumber: '+250788123456',
        amount: 1000,
        status: 'COMPLETED',
        paidAt: new Date('2026-10-28T12:00:00.000Z'),
        validUntil: new Date('2026-11-04T12:00:00.000Z'),
        job: { id: 'job-1' },
      };
      const tx = {
        bookingPayment: {
          create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve(data),
          ),
          delete: jest.fn().mockResolvedValue(existingPayment),
        },
      };
      const prisma = {
        job: { findUnique: jest.fn().mockResolvedValue(job) },
        bookingPayment: {
          findFirst: jest.fn().mockResolvedValue(existingPayment),
        },
        $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
          work(tx),
        ),
      };
      const config = {
        get: jest.fn((key: string) =>
          key === 'jwt.tokenHashSecret' ? 'test-signing-secret' : undefined,
        ),
      };
      const audit = { log: jest.fn().mockResolvedValue(undefined) };
      return {
        service: new PaymentsService(
          prisma as unknown as PrismaService,
          config as unknown as ConfigService,
          audit as unknown as AuditService,
          {} as PaymentProvidersService,
          {} as PaymentEventsService,
        ),
        prisma,
        tx,
        audit,
        existingPayment,
      };
    };

    it('creates a completed payment only for an unlinked completed job', async () => {
      const { service, prisma, tx, audit } = createAdminService();

      const result = await service.createCompletedPayment(
        {
          jobId: 'job-1',
          externalPaymentId: 'provider-ref-002',
          phoneNumber: '+250788123456',
          paidAt: '2026-10-28T12:00:00.000Z',
        },
        'admin-1',
      );

      expect(prisma.job.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'job-1' } }),
      );
      expect(tx.bookingPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jobId: 'job-1',
          customerId: 'customer-1',
          serviceCategoryId: 'category-1',
          amount: 1000,
          status: 'COMPLETED',
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMPLETED_JOB_PAYMENT_CREATED',
          actorId: 'admin-1',
        }),
        tx,
      );
      expect(result).not.toHaveProperty('signature');
      expect(result).not.toHaveProperty('paymentKeyId');
    });

    it('audits a completed payment before deleting it', async () => {
      const { service, tx, audit, existingPayment } = createAdminService();

      await expect(
        service.deleteCompletedPayment('payment-1', 'admin-1'),
      ).resolves.toEqual({ id: 'payment-1', deleted: true });

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'COMPLETED_JOB_PAYMENT_DELETED',
          metadata: expect.objectContaining({
            externalPaymentId: 'provider-ref-001',
            amount: 1000,
          }),
        }),
        tx,
      );
      expect(tx.bookingPayment.delete).toHaveBeenCalledWith({
        where: { id: existingPayment.id },
      });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a category-priced mock payment valid for seven days', async () => {
    const { service, paymentCreate, audit, tx } = createService();
    const result = await service.createMockPayment('customer-1', {
      serviceCategoryId: 'category-1',
    });

    expect(result).toMatchObject({
      externalPaymentId: expect.stringMatching(/^mock_/),
      status: 'SUCCESS',
      bookingStatus: 'VALID',
      serviceCategory: { id: 'category-1', visitFee: 1000 },
      phoneNumber: '+250788123456',
      amount: 1000,
      currency: 'RWF',
      paidAt: fixedNow,
      validUntil: new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(paymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId: 'customer-1',
        serviceCategoryId: 'category-1',
        amount: 1000,
        status: 'VALID',
        paymentKeyId: 'mock-key',
        phoneNumber: '+250788123456',
        signature: expect.any(String),
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MOCK_PAYMENT_SUCCEEDED' }),
      tx,
    );
  });

  it('rejects categories without a positive booking fee', async () => {
    const { service, paymentCreate } = createService(null);

    await expect(
      service.createMockPayment('customer-1', {
        serviceCategoryId: 'category-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('refuses legacy mock payments in production', async () => {
    const { service, paymentCreate } = createService(1000, true, 'production');
    await expect(
      service.createMockPayment('customer-1', {
        serviceCategoryId: 'category-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('reports an explicit configuration error when signing keys are missing', async () => {
    const { service, paymentCreate } = createService(1000, false);

    await expect(
      service.createMockPayment('customer-1', {
        serviceCategoryId: 'category-1',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('records a frontend-reported payment for the exact category fee', async () => {
    const { service, paymentCreate, audit, tx } = createService();
    const result = await service.recordFrontendProcessedPayment('customer-1', {
      serviceCategoryId: 'category-1',
      externalPaymentId: 'provider-ref-001',
      status: 'SUCCESS',
      phoneNumber: '+250788123456',
      amount: 1000,
      paidAt: fixedNow.toISOString(),
    });

    expect(result).toMatchObject({
      externalPaymentId: 'provider-ref-001',
      status: 'SUCCESS',
      bookingStatus: 'VALID',
      amount: 1000,
      providerVerified: false,
      validUntil: new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(paymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalPaymentId: 'provider-ref-001',
        customerId: 'customer-1',
        amount: 1000,
        status: 'VALID',
        paymentKeyId: 'frontend:mock-key',
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FRONTEND_PAYMENT_RECORDED_UNVERIFIED',
      }),
      tx,
    );
  });

  it('rejects frontend-reported payments in production', async () => {
    const { service, prisma } = createService(1000, true, 'production');

    await expect(
      service.recordFrontendProcessedPayment('customer-1', {
        serviceCategoryId: 'category-1',
        externalPaymentId: 'provider-ref-001',
        status: 'SUCCESS',
        phoneNumber: '+250788123456',
        amount: 1000,
        paidAt: fixedNow.toISOString(),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.serviceCategory.findFirst).not.toHaveBeenCalled();
  });

  it('rejects a frontend-reported amount that differs from the category fee', async () => {
    const { service, paymentCreate } = createService();

    await expect(
      service.recordFrontendProcessedPayment('customer-1', {
        serviceCategoryId: 'category-1',
        externalPaymentId: 'provider-ref-001',
        status: 'SUCCESS',
        phoneNumber: '+250788123456',
        amount: 999,
        paidAt: fixedNow.toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('records an old frontend payment as expired instead of making it bookable', async () => {
    const { service, paymentCreate } = createService();
    const paidAt = new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000);

    const result = await service.recordFrontendProcessedPayment('customer-1', {
      serviceCategoryId: 'category-1',
      externalPaymentId: 'provider-ref-expired',
      status: 'SUCCESS',
      phoneNumber: '+250788123456',
      amount: 1000,
      paidAt: paidAt.toISOString(),
    });

    expect(result.bookingStatus).toBe('EXPIRED');
    expect(paymentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'EXPIRED' }),
    });
  });

  it('calculates customer and Fundi charges from the selected normal or SOS fee', async () => {
    const { service, prisma } = createService(2500);
    prisma.serviceCategory.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Plumbing',
      slug: 'plumbing',
      visitFee: 2500,
      sosBookingFee: 5000,
      serviceCharges: [
        {
          id: 'tax',
          name: 'Tax',
          description: null,
          chargeType: ServiceChargeType.PERCENTAGE,
          value: 10,
          payer: ServiceChargePayer.CUSTOMER,
          sortOrder: 1,
        },
        {
          id: 'service',
          name: 'Service charge',
          description: null,
          chargeType: ServiceChargeType.FIXED,
          value: 200,
          payer: ServiceChargePayer.CUSTOMER,
          sortOrder: 2,
        },
        {
          id: 'platform',
          name: 'Platform charge',
          description: null,
          chargeType: ServiceChargeType.PERCENTAGE,
          value: 0.2,
          payer: ServiceChargePayer.FUNDI,
          sortOrder: 3,
        },
      ],
    });

    await expect(
      service.quote({
        serviceCategoryId: 'category-1',
        requestType: JobRequestType.NORMAL,
      }),
    ).resolves.toMatchObject({
      baseFee: 2500,
      customerTotal: 2950,
      fundiTotal: 5,
      total: 2955,
    });
    await expect(
      service.quote({
        serviceCategoryId: 'category-1',
        requestType: JobRequestType.SOS,
      }),
    ).resolves.toMatchObject({
      baseFee: 5000,
      customerTotal: 5700,
      fundiTotal: 10,
      total: 5710,
    });
  });

  it('validates a payment against customer charges only and stores the quote snapshot', async () => {
    const { service, prisma, paymentCreate } = createService(2500);
    prisma.serviceCategory.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Plumbing',
      slug: 'plumbing',
      visitFee: 2500,
      sosBookingFee: 5000,
      serviceCharges: [
        {
          id: 'customer-cost',
          name: 'Tax',
          description: null,
          chargeType: ServiceChargeType.PERCENTAGE,
          value: 10,
          payer: ServiceChargePayer.CUSTOMER,
          sortOrder: 1,
        },
        {
          id: 'fundi-cost',
          name: 'Platform charge',
          description: null,
          chargeType: ServiceChargeType.FIXED,
          value: 500,
          payer: ServiceChargePayer.FUNDI,
          sortOrder: 2,
        },
      ],
    });

    const payment = await service.recordFrontendProcessedPayment('customer-1', {
      serviceCategoryId: 'category-1',
      externalPaymentId: 'provider-ref-expected-total',
      status: 'SUCCESS',
      phoneNumber: '+250788123456',
      amount: 2750,
      paidAt: fixedNow.toISOString(),
    });

    expect(payment.amount).toBe(2750);
    expect(payment.pricingDetails).toMatchObject({
      customerTotal: 2750,
      fundiTotal: 500,
      total: 3250,
    });
    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 2750,
          pricingSnapshot: expect.objectContaining({
            customerTotal: 2750,
            fundiTotal: 500,
          }),
        }),
      }),
    );
  });

  it('returns the expected customer total and quote when submitted amount is wrong', async () => {
    const { service, prisma, paymentCreate } = createService(2500);
    prisma.serviceCategory.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Plumbing',
      slug: 'plumbing',
      visitFee: 2500,
      sosBookingFee: 5000,
      serviceCharges: [
        {
          id: 'customer-cost',
          name: 'Tax',
          description: null,
          chargeType: ServiceChargeType.PERCENTAGE,
          value: 10,
          payer: ServiceChargePayer.CUSTOMER,
          sortOrder: 1,
        },
      ],
    });

    try {
      await service.recordFrontendProcessedPayment('customer-1', {
        serviceCategoryId: 'category-1',
        externalPaymentId: 'provider-ref-wrong-total',
        status: 'SUCCESS',
        phoneNumber: '+250788123456',
        amount: 2500,
        paidAt: fixedNow.toISOString(),
      });
      throw new Error('Expected the payment amount to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        expectedAmount: 2750,
        pricingDetails: { customerTotal: 2750 },
      });
    }
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('creates a pending payment claim with the matching pricing snapshot', async () => {
    const {
      service,
      claimCreate,
      paymentCreate,
      audit,
      tx,
      providers,
      events,
    } = createService();

    const claim = await service.submitPaymentClaim('customer-1', {
      serviceCategoryId: 'category-1',
      amount: 1000,
      paymentMethod: PaymentClaimMethod.MTN,
      paymentNumber: '+250788123456',
    });

    expect(claimCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-1',
          serviceCategoryId: 'category-1',
          requestType: JobRequestType.NORMAL,
          amount: 1000,
          paymentMethod: PaymentClaimMethod.MTN,
          paymentNumber: '+250788123456',
          pricingSnapshot: expect.objectContaining({ customerTotal: 1000 }),
        }),
      }),
    );
    expect(claim).toMatchObject({
      id: 'claim-1',
      status: PaymentClaimStatus.PENDING,
      bookingPayment: null,
      pricingDetails: { customerTotal: 1000 },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBMITTED' }),
      tx,
    );
    expect(providers.assertMode).toHaveBeenCalledWith(tx, 'MTN', 'MANUAL');
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(events.claimCreated).toHaveBeenCalledWith(claim);
  });

  it('rejects new mobile money claims when their provider is in API mode', async () => {
    const { service, providers, claimCreate, events } = createService();
    providers.assertMode.mockRejectedValue(
      new ConflictException('Use API payments.'),
    );
    await expect(
      service.submitPaymentClaim('customer-1', {
        serviceCategoryId: 'category-1',
        amount: 1000,
        paymentMethod: PaymentClaimMethod.MTN,
        paymentNumber: '+250788123456',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(claimCreate).not.toHaveBeenCalled();
    expect(events.claimCreated).not.toHaveBeenCalled();
  });

  it('does not notify admins if submitting a claim fails to commit', async () => {
    const { service, prisma, events } = createService();
    prisma.$transaction.mockRejectedValueOnce(new Error('Commit failed'));
    await expect(
      service.submitPaymentClaim('customer-1', {
        serviceCategoryId: 'category-1',
        amount: 1000,
        paymentMethod: PaymentClaimMethod.MTN,
        paymentNumber: '+250788123456',
      }),
    ).rejects.toThrow('Commit failed');
    expect(events.claimCreated).not.toHaveBeenCalled();
  });

  it('returns the claim already waiting instead of queueing the same payment twice', async () => {
    const { service, claimCreate, tx } = createService();
    (tx.paymentClaim.findFirst as jest.Mock).mockResolvedValue({
      id: 'claim-waiting',
    });

    await expect(
      service.submitPaymentClaim('customer-1', {
        serviceCategoryId: 'category-1',
        amount: 1000,
        paymentMethod: PaymentClaimMethod.MTN,
        paymentNumber: '+250788123456',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ existingClaimId: 'claim-waiting' }),
    });
    expect(tx.paymentClaim.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        customerId: 'customer-1',
        serviceCategoryId: 'category-1',
        paymentMethod: PaymentClaimMethod.MTN,
        paymentNumber: '+250788123456',
        status: PaymentClaimStatus.PENDING,
      }),
      select: { id: true },
    });
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('returns the claim already waiting instead of queueing the same payment twice', async () => {
    const { service, claimCreate, tx } = createService();
    (tx.paymentClaim.findFirst as jest.Mock).mockResolvedValue({ id: 'claim-waiting' });

    await expect(
      service.submitPaymentClaim('customer-1', {
        serviceCategoryId: 'category-1',
        amount: 1000,
        paymentMethod: PaymentClaimMethod.MTN,
        paymentNumber: '+250788123456',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ existingClaimId: 'claim-waiting' }),
    });
    expect(tx.paymentClaim.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        customerId: 'customer-1',
        serviceCategoryId: 'category-1',
        paymentMethod: PaymentClaimMethod.MTN,
        paymentNumber: '+250788123456',
        status: PaymentClaimStatus.PENDING,
      }),
      select: { id: true },
    });
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('rejects a claim amount that differs from the current customer total', async () => {
    const { service, claimCreate } = createService();

    await expect(
      service.submitPaymentClaim('customer-1', {
        serviceCategoryId: 'category-1',
        amount: 999,
        paymentMethod: PaymentClaimMethod.AIRTEL,
        paymentNumber: '+250788123456',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        expectedAmount: 1000,
        pricingDetails: expect.objectContaining({ customerTotal: 1000 }),
      }),
    });
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('only returns the signed-in user’s claims and filters admin lists by status', async () => {
    const { service, claimFindMany } = createService();
    const savedClaim = {
      id: 'claim-1',
      customerId: 'customer-1',
      pricingSnapshot: { customerTotal: 1000 },
      bookingPayment: null,
    };
    claimFindMany.mockResolvedValue([savedClaim]);

    await expect(service.listMyPaymentClaims('customer-1')).resolves.toEqual([
      {
        id: 'claim-1',
        customerId: 'customer-1',
        bookingPayment: null,
        pricingDetails: { customerTotal: 1000 },
      },
    ]);
    expect(claimFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { customerId: 'customer-1' } }),
    );

    await service.listPaymentClaimsForAdmin({
      status: PaymentClaimStatus.PENDING,
    });
    expect(claimFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { status: PaymentClaimStatus.PENDING },
      }),
    );
  });

  it('creates a valid booking payment when an admin approves a pending claim', async () => {
    const {
      service,
      claimFindUnique,
      claimUpdate,
      paymentCreate,
      audit,
      tx,
      events,
      providers,
    } = createService();
    const claim = {
      id: 'claim-1',
      customerId: 'customer-1',
      serviceCategoryId: 'category-1',
      requestType: JobRequestType.NORMAL,
      amount: 1000,
      paymentMethod: PaymentClaimMethod.MTN,
      paymentNumber: '+250788123456',
      pricingSnapshot: { customerTotal: 1000 },
      status: PaymentClaimStatus.PENDING,
      customer: {
        id: 'customer-1',
        fullName: 'Customer One',
        phoneNumber: '+250788123456',
      },
      serviceCategory: { id: 'category-1', name: 'Plumbing', slug: 'plumbing' },
      reviewedBy: null,
      bookingPayment: null,
    };
    claimFindUnique
      .mockResolvedValueOnce({ id: claim.id, status: claim.status })
      .mockResolvedValueOnce(claim);
    claimUpdate.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...claim,
          ...data,
          bookingPayment: {
            id: data.bookingPaymentId,
            jobId: null,
            status: 'VALID',
            amount: 1000,
            paidAt: fixedNow,
            validUntil: new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000),
          },
        }),
    );

    const result = await service.reviewPaymentClaim(
      'claim-1',
      { status: PaymentClaimStatus.APPROVED },
      'admin-1',
    );

    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer-1',
          serviceCategoryId: 'category-1',
          amount: 1000,
          status: 'VALID',
          paymentKeyId: 'claim:mock-key',
          externalPaymentId: 'claim_claim-1',
          phoneNumber: '+250788123456',
          pricingSnapshot: { customerTotal: 1000 },
          validUntil: new Date(fixedNow.getTime() + 7 * 24 * 60 * 60 * 1000),
        }),
      }),
    );
    expect(claimUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'claim-1' },
        data: expect.objectContaining({
          status: PaymentClaimStatus.APPROVED,
          reviewedById: 'admin-1',
          bookingPaymentId: expect.any(String),
        }),
      }),
    );
    expect(result).toMatchObject({
      status: PaymentClaimStatus.APPROVED,
      bookingPayment: { status: 'VALID', amount: 1000 },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PAYMENT_CLAIM_APPROVED' }),
      tx,
    );
    expect(events.claimReviewed).toHaveBeenCalledWith(result);
    // Claims submitted while manual remain reviewable after enabling API mode.
    expect(providers.assertMode).not.toHaveBeenCalled();
  });

  it('rejects a claim without creating a booking payment', async () => {
    const { service, claimFindUnique, claimUpdate, paymentCreate, events } =
      createService();
    const claim = {
      id: 'claim-1',
      customerId: 'customer-1',
      serviceCategoryId: 'category-1',
      requestType: JobRequestType.NORMAL,
      amount: 1000,
      paymentMethod: PaymentClaimMethod.AIRTEL,
      paymentNumber: '+250788123456',
      pricingSnapshot: { customerTotal: 1000 },
      status: PaymentClaimStatus.PENDING,
      customer: {
        id: 'customer-1',
        fullName: 'Customer One',
        phoneNumber: '+250788123456',
      },
      serviceCategory: { id: 'category-1', name: 'Plumbing', slug: 'plumbing' },
      reviewedBy: null,
      bookingPayment: null,
    };
    claimFindUnique
      .mockResolvedValueOnce({ id: claim.id, status: claim.status })
      .mockResolvedValueOnce(claim);
    claimUpdate.mockResolvedValue({
      ...claim,
      status: PaymentClaimStatus.REJECTED,
      reviewNote: 'Payment could not be verified.',
      bookingPayment: null,
    });

    await service.reviewPaymentClaim(
      'claim-1',
      {
        status: PaymentClaimStatus.REJECTED,
        reviewNote: 'Payment could not be verified.',
      },
      'admin-1',
    );

    expect(paymentCreate).not.toHaveBeenCalled();
    const updateData = claimUpdate.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(updateData).toMatchObject({
      status: PaymentClaimStatus.REJECTED,
      reviewNote: 'Payment could not be verified.',
    });
    expect(updateData).not.toHaveProperty('bookingPaymentId');
    expect(events.claimReviewed).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'REJECTED',
        bookingPayment: null,
      }),
    );
  });

  it('does not accept a full card number as a claim payment reference', async () => {
    const { service, claimCreate } = createService();

    await expect(
      service.submitPaymentClaim('customer-1', {
        serviceCategoryId: 'category-1',
        amount: 1000,
        paymentMethod: PaymentClaimMethod.CREDIT_CARD,
        paymentNumber: '4111111111111111',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(claimCreate).not.toHaveBeenCalled();
  });

  it('audits and deletes a claim without deleting its issued payment', async () => {
    const { service, claimFindUnique, claimDelete, paymentCreate, audit, tx } =
      createService();
    claimFindUnique.mockResolvedValue({
      id: 'claim-1',
      customerId: 'customer-1',
      serviceCategoryId: 'category-1',
      amount: 1000,
      paymentMethod: PaymentClaimMethod.MTN,
      status: PaymentClaimStatus.APPROVED,
      bookingPaymentId: 'payment-1',
    });

    await expect(
      service.deletePaymentClaim('claim-1', 'admin-1'),
    ).resolves.toEqual({ id: 'claim-1', deleted: true });

    expect(claimDelete).toHaveBeenCalledWith({ where: { id: 'claim-1' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETED',
        metadata: expect.objectContaining({ bookingPaymentId: 'payment-1' }),
      }),
      tx,
    );
    expect(paymentCreate).not.toHaveBeenCalled();
  });
});
