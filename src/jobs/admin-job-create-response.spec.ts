import { ConflictException } from '@nestjs/common';
import { JobRequestType } from '@prisma/client';
import { JobsService } from './jobs.service';

describe('Admin job creation response', () => {
  it('runs payment validation and creation, then reads only the admin representation', async () => {
    const tx = {
      job: { create: jest.fn().mockResolvedValue(undefined) },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ role: 'CUSTOMER', phoneVerifiedAt: new Date() }),
      },
      bookingPayment: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'payment',
          status: 'VALID',
          requestType: 'NORMAL',
          validUntil: new Date(Date.now() + 60_000),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ monthKey: '1126', lastNumber: 1 }]),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'customer',
          role: 'CUSTOMER',
          status: 'ACTIVE',
        }),
      },
      serviceCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category' }),
      },
      $transaction: jest.fn(async (run: (client: typeof tx) => unknown) =>
        run(tx),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new JobsService(
      prisma as never,
      {} as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(
        service as unknown as { findMatches: () => Promise<unknown[]> },
        'findMatches',
      )
      .mockResolvedValue([]);
    const result = { id: 'created-job', offers: [] };
    const adminRead = jest
      .spyOn(service, 'getForAdmin')
      .mockResolvedValue(result as never);
    const customerRead = jest.spyOn(service, 'getCustomerJob');
    const input = {
      customerId: 'customer',
      paymentId: 'payment',
      serviceCategoryId: 'category',
      description: 'Repair the kitchen sink',
      locationAddress: 'Kigali',
      latitude: -1.9,
      longitude: 30,
      offeredAmount: 20000,
    };
    expect(await service.createForAdmin(input, 'admin')).toBe(result);
    const createdId = tx.job.create.mock.calls[0][0].data.id;
    expect(adminRead).toHaveBeenCalledWith(createdId);
    expect(adminRead).toHaveBeenCalledTimes(1);
    expect(customerRead).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'admin', entityId: createdId }),
      tx,
    );

    tx.bookingPayment.findFirst.mockResolvedValue(null);
    await expect(service.createForAdmin(input, 'admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.job.create).toHaveBeenCalledTimes(1);
    expect(adminRead).toHaveBeenCalledTimes(1);
  });

  it('requests the admin representation directly instead of fetching customer details first', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'customer',
          role: 'CUSTOMER',
          status: 'ACTIVE',
        }),
      },
    };
    const service = new JobsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = { id: 'job', offers: [] };
    const create = jest
      .spyOn(service, 'create')
      .mockResolvedValue(result as never);
    const getForAdmin = jest.spyOn(service, 'getForAdmin');
    const input = { customerId: 'customer', requestType: JobRequestType.SOS };
    expect(await service.createForAdmin(input as never, 'admin')).toBe(result);
    expect(create).toHaveBeenCalledWith(
      'customer',
      { requestType: 'SOS' },
      [],
      undefined,
      'admin',
      'SOS',
      'admin',
    );
    expect(getForAdmin).not.toHaveBeenCalled();
  });
});
