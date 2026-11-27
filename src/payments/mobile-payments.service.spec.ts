import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingPaymentStatus,
  JobRequestType,
  MobilePaymentProvider,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { MobilePaymentsService } from './mobile-payments.service';
import { PaymentProvidersService } from './payment-providers.service';
import { PaymentEventsService } from './payment-events.service';
import { PaymentsService } from './payments.service';

describe('Mobile payment modes and simulated checkout', () => {
  const customerId = 'customer-1';
  const dto = {
    provider: MobilePaymentProvider.MTN,
    serviceCategoryId: 'service-1',
    phoneNumber: '+250788123456',
    idempotencyKey: 'key-1',
  };
  const now = new Date('2026-11-24T12:00:00Z');

  function setup(environment = 'development') {
    const settings = new Map(
      Object.values(MobilePaymentProvider).map((provider) => [
        provider,
        {
          provider,
          apiEnabled: false,
          updatedAt: now,
        },
      ]),
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      paymentProviderSetting: {
        findMany: jest.fn(async () => [...settings.values()]),
        findUnique: jest.fn(
          async ({ where }: { where: { provider: MobilePaymentProvider } }) =>
            settings.get(where.provider),
        ),
        upsert: jest.fn(
          async ({
            where,
            update,
          }: {
            where: { provider: MobilePaymentProvider };
            update: { apiEnabled: boolean };
          }) => {
            const saved = {
              provider: where.provider,
              apiEnabled: update.apiEnabled,
              updatedAt: now,
            };
            settings.set(where.provider, saved);
            return saved;
          },
        ),
      },
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(
          async ({
            data,
          }: {
            data: Prisma.PaymentTransactionUncheckedCreateInput;
          }) => ({
            ...data,
            createdAt: now,
            updatedAt: now,
            bookingPayment: {
              id: data.bookingPaymentId,
              status: BookingPaymentStatus.VALID,
              paidAt: now,
              validUntil: new Date(now.getTime() + 604800000),
              jobId: null,
            },
          }),
        ),
      },
      bookingPayment: {
        create: jest.fn(
          async ({
            data,
          }: {
            data: Prisma.BookingPaymentUncheckedCreateInput;
          }) => data,
        ),
      },
      paymentClaim: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            environment,
            'mockPayment.key': 'test-key',
            'mockPayment.secret': 'test-secret',
          })[key],
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const events = { paymentStatus: jest.fn().mockResolvedValue(undefined) };
    const payments = {
      quote: jest.fn().mockResolvedValue({
        serviceCategory: { id: 'service-1', name: 'Plumbing' },
        currency: 'RWF',
        baseFee: 1000,
        customerTotal: 1250,
        fundiTotal: 100,
        total: 1350,
      }),
    };
    const providers = new PaymentProvidersService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
    );
    const service = new MobilePaymentsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
      providers,
      payments as unknown as PaymentsService,
      events as unknown as PaymentEventsService,
    );
    return {
      service,
      providers,
      prisma,
      tx,
      settings,
      audit,
      events,
      payments,
      config,
    };
  }

  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it('defaults both providers to manual and persists/audits independent toggles', async () => {
    const { providers, audit, tx } = setup();
    expect(await providers.list()).toEqual([
      expect.objectContaining({
        provider: 'MTN',
        apiEnabled: false,
        mode: 'MANUAL',
      }),
      expect.objectContaining({
        provider: 'AIRTEL',
        apiEnabled: false,
        mode: 'MANUAL',
      }),
    ]);
    await providers.update(MobilePaymentProvider.MTN, true, 'admin-1');
    expect(await providers.list()).toEqual([
      expect.objectContaining({
        provider: 'MTN',
        apiEnabled: true,
        mode: 'API',
        executionMode: 'SIMULATED',
      }),
      expect.objectContaining({
        provider: 'AIRTEL',
        apiEnabled: false,
        mode: 'MANUAL',
      }),
    ]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        fromStatus: 'MANUAL',
        toStatus: 'API',
        entityId: 'MTN',
      }),
      tx,
    );
    await providers.update(MobilePaymentProvider.AIRTEL, true, 'admin-1');
    await providers.update(MobilePaymentProvider.MTN, false, 'admin-1');
    expect(await providers.list()).toEqual([
      expect.objectContaining({ provider: 'MTN', mode: 'MANUAL' }),
      expect.objectContaining({ provider: 'AIRTEL', mode: 'API' }),
    ]);
  });

  it('defaults to manual if a setting row is absent', async () => {
    const { providers, settings } = setup();
    settings.clear();
    expect(await providers.list()).toEqual([
      expect.objectContaining({ provider: 'MTN', mode: 'MANUAL' }),
      expect.objectContaining({ provider: 'AIRTEL', mode: 'MANUAL' }),
    ]);
  });

  it.each(['production', 'staging'])(
    'never simulates in %s, including with a leftover enabled toggle',
    async (environment) => {
      const { providers, service, settings, tx } = setup(environment);
      settings.get(MobilePaymentProvider.MTN)!.apiEnabled = true;
      expect(await providers.list()).toContainEqual(
        expect.objectContaining({
          provider: 'MTN',
          apiEnabled: true,
          mode: 'MANUAL',
          apiAvailable: false,
        }),
      );
      await expect(
        providers.update(MobilePaymentProvider.MTN, true, 'admin-1'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(service.initiate(customerId, dto)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(tx.bookingPayment.create).not.toHaveBeenCalled();
      await expect(
        providers.update(MobilePaymentProvider.MTN, false, 'admin-1'),
      ).resolves.toMatchObject({ mode: 'MANUAL' });
    },
  );

  it('enforces the selected provider mode server-side', async () => {
    const { service, providers, tx, events } = setup();
    await providers.update(MobilePaymentProvider.MTN, true, 'admin-1');
    await expect(
      service.initiate(customerId, {
        ...dto,
        provider: MobilePaymentProvider.AIRTEL,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ provider: 'AIRTEL', mode: 'MANUAL' }),
    });
    expect(tx.bookingPayment.create).not.toHaveBeenCalled();
    expect(events.paymentStatus).not.toHaveBeenCalled();
  });

  it.each([MobilePaymentProvider.MTN, MobilePaymentProvider.AIRTEL])(
    'records a server-priced simulated %s payment and then emits success',
    async (provider) => {
      const { service, providers, tx, events, payments, prisma } =
        setup('test');
      await providers.update(provider, true, 'admin-1');
      let committed = false;
      prisma.$transaction.mockImplementationOnce(async (work) => {
        const result = await work(tx);
        expect(events.paymentStatus).not.toHaveBeenCalled();
        committed = true;
        return result;
      });
      events.paymentStatus.mockImplementation(async () => {
        expect(committed).toBe(true);
      });
      const result = await service.initiate(customerId, {
        ...dto,
        provider,
        requestType: JobRequestType.SOS,
      });
      expect(payments.quote).toHaveBeenCalledWith(
        {
          serviceCategoryId: 'service-1',
          requestType: 'SOS',
        },
        tx,
      );
      expect(result).toMatchObject({
        provider,
        status: 'SUCCESS',
        simulated: true,
        providerVerified: false,
        amount: 1250,
        currency: 'RWF',
        bookingPaymentId: expect.any(String),
        bookingPayment: {
          status: 'VALID',
          validUntil: new Date(now.getTime() + 604800000),
        },
      });
      expect(tx.bookingPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId,
          amount: 1250,
          requestType: 'SOS',
          phoneNumber: dto.phoneNumber,
          status: 'VALID',
          signature: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      });
      expect(events.paymentStatus).toHaveBeenCalledWith(
        customerId,
        expect.objectContaining({
          transactionId: result.id,
          bookingPaymentId: result.bookingPaymentId,
          simulated: true,
          status: 'SUCCESS',
        }),
      );
      expect(result).not.toHaveProperty('idempotencyKey');
      expect(result.bookingPayment).not.toHaveProperty('signature');
    },
  );

  it('replays the same payment even after disabling the provider without charging or notifying twice', async () => {
    const { service, providers, tx, events, payments } = setup();
    await providers.update(MobilePaymentProvider.MTN, true, 'admin-1');
    const first = await service.initiate(customerId, dto);
    const saved = await tx.paymentTransaction.create.mock.results[0].value;
    tx.paymentTransaction.findUnique.mockResolvedValue(saved);
    await providers.update(MobilePaymentProvider.MTN, false, 'admin-1');
    expect(await service.initiate(customerId, dto)).toEqual(first);
    expect(tx.bookingPayment.create).toHaveBeenCalledTimes(1);
    expect(tx.paymentTransaction.create).toHaveBeenCalledTimes(1);
    expect(payments.quote).toHaveBeenCalledTimes(1);
    expect(events.paymentStatus).toHaveBeenCalledTimes(1);
    await expect(
      service.initiate(customerId, { ...dto, phoneNumber: '+250788123457' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not start another payment while a manual claim awaits review', async () => {
    const { service, providers, tx } = setup();
    await providers.update(MobilePaymentProvider.MTN, true, 'admin-1');
    tx.paymentClaim.findFirst.mockResolvedValue({ id: 'pending-claim' });
    await expect(service.initiate(customerId, dto)).rejects.toMatchObject({
      response: expect.objectContaining({ existingClaimId: 'pending-claim' }),
    });
    expect(tx.bookingPayment.create).not.toHaveBeenCalled();
  });

  it('does not issue a payment without signing configuration or notify on a failed transaction', async () => {
    const { service, providers, config, tx, events, prisma } = setup();
    await providers.update(MobilePaymentProvider.MTN, true, 'admin-1');
    config.get.mockImplementation((key) =>
      key === 'environment' ? 'development' : undefined,
    );
    await expect(service.initiate(customerId, dto)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(tx.bookingPayment.create).not.toHaveBeenCalled();
    prisma.$transaction.mockRejectedValueOnce(new Error('Commit failed'));
    await expect(service.initiate(customerId, dto)).rejects.toThrow(
      'Commit failed',
    );
    expect(events.paymentStatus).not.toHaveBeenCalled();
  });

  it('restricts transaction recovery to its owner', async () => {
    const { service, tx } = setup();
    await expect(
      service.getTransaction('another-user', 'transaction-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.paymentTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'transaction-1', customerId: 'another-user' },
      }),
    );
  });
});
