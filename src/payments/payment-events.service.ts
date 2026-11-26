import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventsGateway } from '../websockets/events.gateway';
import { PermissionsService } from '../staff/permissions.service';

interface ClaimEvent {
  id: string;
  customerId: string;
  amount: number;
  paymentMethod: string;
  status: string;
  bookingPaymentId: string | null;
  reviewNote: string | null;
}

export interface PaymentStatusEvent {
  transactionId: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  simulated: boolean;
  bookingPaymentId: string | null;
}

/** Called only after commit. Delivery failure must not turn a recorded payment into an HTTP failure. */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly notifications: NotificationsService,
    private readonly permissions: PermissionsService,
  ) {}

  async claimCreated(claim: ClaimEvent) {
    try {
      const admins = await this.prisma.user.findMany({
        where: this.permissions.recipientsWhere(['payments.view']),
        select: { id: true },
      });
      const data = {
        requiredPermission: 'payments.view',
        claimId: claim.id,
        customerId: claim.customerId,
        amount: claim.amount,
        currency: 'RWF',
        paymentMethod: claim.paymentMethod,
        status: claim.status,
      };
      for (const admin of admins) {
        await this.events.notifyStaff(admin.id, 'payment-claim:created', data, [
          'payments.view',
        ]);
      }
      await this.notifications.createManyForUsers({
        userIds: admins.map((admin) => admin.id),
        type: NotificationType.SYSTEM,
        title: 'Payment awaiting verification',
        body: `A ${claim.amount} RWF ${claim.paymentMethod} payment claim needs review.`,
        data,
      });
    } catch (error) {
      this.deliveryFailed(claim.id, error);
    }
  }

  async claimReviewed(claim: ClaimEvent) {
    try {
      const data = {
        claimId: claim.id,
        status: claim.status,
        bookingPaymentId: claim.bookingPaymentId,
        reviewNote: claim.reviewNote,
      };
      this.events.notifyUser(claim.customerId, 'payment-claim:reviewed', data);
      await this.notifications.create({
        userId: claim.customerId,
        type: NotificationType.SYSTEM,
        title:
          claim.status === 'APPROVED' ? 'Payment approved' : 'Payment rejected',
        body:
          claim.status === 'APPROVED'
            ? 'Your payment has been verified. You can now submit your job request.'
            : claim.reviewNote ||
              'Your payment could not be verified. Please check the payment details.',
        data,
        dedupeKey: `payment-claim:${claim.id}:${claim.status}`,
      });
    } catch (error) {
      this.deliveryFailed(claim.id, error);
    }
  }

  async paymentStatus(customerId: string, data: PaymentStatusEvent) {
    try {
      this.events.notifyUser(customerId, 'payment:status', data);
      await this.notifications.create({
        userId: customerId,
        type: NotificationType.SYSTEM,
        title: data.simulated
          ? 'Development payment successful'
          : 'Payment successful',
        body: `Your ${data.amount} ${data.currency} payment is recorded. You can now submit your job request.`,
        data: { ...data },
        dedupeKey: `payment:${data.transactionId}:${data.status}`,
      });
    } catch (error) {
      this.deliveryFailed(data.transactionId, error);
    }
  }

  private deliveryFailed(id: string, error: unknown) {
    this.logger.warn(
      `Payment notification delivery failed for ${id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
