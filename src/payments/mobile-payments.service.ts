import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BookingPaymentStatus,
  JobRequestType,
  PaymentClaimStatus,
  PaymentTransactionStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { PaymentEventsService } from './payment-events.service';
import { PaymentProvidersService } from './payment-providers.service';
import { PaymentsService } from './payments.service';
import { signBookingPayment } from './payment-signature';

const TRANSACTION_INCLUDE = {
  bookingPayment: {
    select: {
      id: true,
      status: true,
      paidAt: true,
      validUntil: true,
      jobId: true,
    },
  },
} satisfies Prisma.PaymentTransactionInclude;

type TransactionWithPayment = Prisma.PaymentTransactionGetPayload<{
  include: typeof TRANSACTION_INCLUDE;
}>;

@Injectable()
export class MobilePaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly providers: PaymentProvidersService,
    private readonly payments: PaymentsService,
    private readonly events: PaymentEventsService,
  ) {}

  async initiate(customerId: string, dto: InitiatePaymentDto) {
    this.providers.assertSimulationAvailable();
    const requestType = dto.requestType ?? JobRequestType.NORMAL;
    const { transaction, created } = await this.prisma.$transaction(
      async (tx) => {
        // Serializes retries and claim submissions for this customer across API instances.
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${customerId} FOR UPDATE`;
        const existing = await tx.paymentTransaction.findUnique({
          where: {
            customerId_idempotencyKey: {
              customerId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
          include: TRANSACTION_INCLUDE,
        });
        if (existing) {
          if (
            existing.provider !== dto.provider ||
            existing.phoneNumber !== dto.phoneNumber ||
            existing.serviceCategoryId !== dto.serviceCategoryId ||
            existing.requestType !== requestType
          ) {
            throw new ConflictException(
              'This idempotency key was already used for a different payment request.',
            );
          }
          // A successful retry remains readable even after an admin changes the mode or price.
          return { transaction: existing, created: false };
        }
        await this.providers.assertMode(tx, dto.provider, 'API');
        const pendingClaim = await tx.paymentClaim.findFirst({
          where: {
            customerId,
            serviceCategoryId: dto.serviceCategoryId,
            requestType,
            status: PaymentClaimStatus.PENDING,
          },
          select: { id: true },
        });
        if (pendingClaim) {
          throw new ConflictException({
            message:
              'A manual payment for this service is awaiting review. Wait for the admin decision before paying again.',
            existingClaimId: pendingClaim.id,
          });
        }
        const pricing = await this.payments.quote(
          {
            serviceCategoryId: dto.serviceCategoryId,
            requestType,
          },
          tx,
        );
        const key = this.config.get<string>('mockPayment.key');
        const secret = this.config.get<string>('mockPayment.secret');
        if (!key || !secret) {
          throw new ServiceUnavailableException(
            'Simulated payment signing requires MOCK_PAYMENT_KEY and MOCK_PAYMENT_SECRET.',
          );
        }
        const transactionId = randomUUID();
        const paymentId = randomUUID();
        const externalPaymentId = `simulated_${dto.provider.toLowerCase()}_${transactionId}`;
        const paidAt = new Date();
        const payment = await tx.bookingPayment.create({
          data: {
            id: paymentId,
            customerId,
            serviceCategoryId: pricing.serviceCategory.id,
            requestType,
            externalPaymentId,
            paymentKeyId: `simulated:${dto.provider}:${key}`,
            signature: signBookingPayment(
              secret,
              paymentId,
              externalPaymentId,
              customerId,
              pricing.serviceCategory.id,
              pricing.customerTotal,
              dto.phoneNumber,
              paidAt,
              requestType,
              pricing,
            ),
            phoneNumber: dto.phoneNumber,
            amount: pricing.customerTotal,
            pricingSnapshot: pricing,
            status: BookingPaymentStatus.VALID,
            paidAt,
            validUntil: new Date(paidAt.getTime() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        const transaction = await tx.paymentTransaction.create({
          data: {
            id: transactionId,
            customerId,
            serviceCategoryId: pricing.serviceCategory.id,
            provider: dto.provider,
            requestType,
            phoneNumber: dto.phoneNumber,
            amount: pricing.customerTotal,
            currency: pricing.currency,
            pricingSnapshot: pricing,
            status: PaymentTransactionStatus.SUCCESS,
            simulated: true,
            idempotencyKey: dto.idempotencyKey,
            externalPaymentId,
            bookingPaymentId: payment.id,
          },
          include: TRANSACTION_INCLUDE,
        });
        await this.audit.log(
          {
            entityType: 'BookingPayment',
            entityId: payment.id,
            action: 'SIMULATED_MOBILE_PAYMENT_SUCCEEDED',
            actorId: customerId,
            toStatus: BookingPaymentStatus.VALID,
            metadata: {
              transactionId,
              provider: dto.provider,
              simulated: true,
              amount: payment.amount,
              externalPaymentId,
            },
          },
          tx,
        );
        return { transaction, created: true };
      },
    );

    const response = this.toResponse(transaction);
    if (created) {
      await this.events.paymentStatus(customerId, {
        transactionId: transaction.id,
        provider: transaction.provider,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        simulated: transaction.simulated,
        bookingPaymentId: transaction.bookingPaymentId,
      });
    }
    return response;
  }

  async getTransaction(customerId: string, id: string) {
    const transaction = await this.prisma.paymentTransaction.findFirst({
      where: { id, customerId },
      include: TRANSACTION_INCLUDE,
    });
    if (!transaction)
      throw new NotFoundException('Payment transaction not found.');
    return this.toResponse(transaction);
  }

  private toResponse(transaction: TransactionWithPayment) {
    return {
      id: transaction.id,
      provider: transaction.provider,
      status: transaction.status,
      simulated: transaction.simulated,
      providerVerified:
        !transaction.simulated &&
        transaction.status === PaymentTransactionStatus.SUCCESS,
      serviceCategoryId: transaction.serviceCategoryId,
      requestType: transaction.requestType,
      phoneNumber: transaction.phoneNumber,
      amount: transaction.amount,
      currency: transaction.currency,
      pricingDetails: transaction.pricingSnapshot,
      externalPaymentId: transaction.externalPaymentId,
      bookingPaymentId: transaction.bookingPaymentId,
      bookingPayment: transaction.bookingPayment,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }
}
