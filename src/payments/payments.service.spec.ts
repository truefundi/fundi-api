import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService mock booking payments', () => {
  const fixedNow = new Date('2026-10-28T12:00:00.000Z');

  const createService = (
    bookingFee: number | null = 1000,
    configured = true,
    environment = 'development',
  ) => {
    const category = {
      id: 'category-1',
      name: 'Plumbing',
      bookingFee,
    };
    const paymentCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(data),
    );
    const tx = {
      bookingPayment: { create: paymentCreate },
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
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
    return { service, prisma, paymentCreate, audit, tx };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(fixedNow);
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
        serviceCategory: { id: 'category-1', bookingFee: 1000 },
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
      serviceCategory: { id: 'category-1', bookingFee: 1000 },
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
});
