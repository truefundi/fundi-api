import { Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsGateway } from '../websockets/events.gateway';
import { PaymentEventsService } from './payment-events.service';

describe('Payment event delivery', () => {
  const claim = {
    id: 'claim-1',
    customerId: 'customer-1',
    amount: 1000,
    paymentMethod: 'MTN',
    status: 'PENDING',
    bookingPaymentId: null,
    reviewNote: null,
  };
  function setup() {
    const prisma = {
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]),
      },
    };
    const events = { notifyUser: jest.fn() };
    const notifications = {
      create: jest.fn().mockResolvedValue({}),
      createManyForUsers: jest.fn().mockResolvedValue(2),
    };
    const service = new PaymentEventsService(
      prisma as unknown as PrismaService,
      events as unknown as EventsGateway,
      notifications as unknown as NotificationsService,
    );
    return { service, prisma, events, notifications };
  }

  it('notifies active admins and stores inbox notifications for offline dashboard users', async () => {
    const { service, prisma, events, notifications } = setup();
    await service.claimCreated(claim);
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    expect(events.notifyUser).toHaveBeenCalledTimes(2);
    expect(events.notifyUser).toHaveBeenCalledWith(
      'admin-1',
      'payment-claim:created',
      expect.objectContaining({ claimId: claim.id }),
    );
    expect(notifications.createManyForUsers).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['admin-1', 'admin-2'] }),
    );
  });

  it.each(['APPROVED', 'REJECTED'])(
    'delivers %s only to the claimant',
    async (status) => {
      const { service, events } = setup();
      const bookingPaymentId = status === 'APPROVED' ? 'payment-1' : null;
      await service.claimReviewed({ ...claim, status, bookingPaymentId });
      expect(events.notifyUser).toHaveBeenCalledTimes(1);
      expect(events.notifyUser).toHaveBeenCalledWith(
        'customer-1',
        'payment-claim:reviewed',
        {
          claimId: 'claim-1',
          status,
          bookingPaymentId,
          reviewNote: null,
        },
      );
    },
  );

  it('does not turn a committed payment into a failure when notification storage fails', async () => {
    const { service, notifications, events } = setup();
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    notifications.create.mockRejectedValue(
      new Error('Notifications unavailable'),
    );
    await expect(
      service.paymentStatus('customer-1', {
        transactionId: 'transaction-1',
        provider: 'MTN',
        status: 'SUCCESS',
        simulated: true,
        amount: 1000,
        currency: 'RWF',
        bookingPaymentId: 'payment-1',
      }),
    ).resolves.toBeUndefined();
    expect(events.notifyUser).toHaveBeenCalledWith(
      'customer-1',
      'payment:status',
      expect.objectContaining({ bookingPaymentId: 'payment-1' }),
    );
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
