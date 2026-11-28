import { BadRequestException } from '@nestjs/common';
import { BookingPaymentStatus, Prisma } from '@prisma/client';
import { ListAdminPaymentsQueryDto } from './dto/list-admin-payments-query.dto';

export const ADMIN_PAYMENT_LIST_SELECT = {
  id: true,
  customerId: true,
  serviceCategoryId: true,
  jobId: true,
  externalPaymentId: true,
  phoneNumber: true,
  amount: true,
  requestType: true,
  status: true,
  paidAt: true,
  validUntil: true,
  remainingValiditySeconds: true,
  extensionCount: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, fullName: true, phoneNumber: true } },
  serviceCategory: { select: { id: true, name: true, slug: true } },
  job: {
    select: {
      id: true,
      status: true,
      description: true,
      createdAt: true,
      completedAt: true,
    },
  },
} satisfies Prisma.BookingPaymentSelect;

export interface PaymentListAssignment {
  jobId: string;
  technicianId: string | null;
  technicianName: string;
  acceptedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  reason: string | null;
}

export function effectivePaymentStatus<
  T extends { status: BookingPaymentStatus; validUntil: Date },
>(payment: T, now: Date): BookingPaymentStatus {
  return (payment.status === BookingPaymentStatus.VALID ||
    payment.status === BookingPaymentStatus.RESUMED) &&
    payment.validUntil <= now
    ? BookingPaymentStatus.EXPIRED
    : payment.status;
}

export function paymentStatusWhere(
  status: BookingPaymentStatus,
  now: Date,
): Prisma.BookingPaymentWhereInput {
  if (status === BookingPaymentStatus.EXPIRED) {
    return {
      OR: [
        { status },
        {
          status: {
            in: [BookingPaymentStatus.VALID, BookingPaymentStatus.RESUMED],
          },
          validUntil: { lte: now },
        },
      ],
    };
  }
  return {
    status,
    ...(status === BookingPaymentStatus.VALID ||
    status === BookingPaymentStatus.RESUMED
      ? { validUntil: { gt: now } }
      : {}),
  };
}

export function adminPaymentWhere(
  query: ListAdminPaymentsQueryDto,
  now: Date,
): Prisma.BookingPaymentWhereInput {
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if (
    (from && !Number.isFinite(from.getTime())) ||
    (to && !Number.isFinite(to.getTime())) ||
    (from && to && from >= to)
  ) {
    throw new BadRequestException(
      'from must be earlier than the exclusive to date.',
    );
  }
  const conditions: Prisma.BookingPaymentWhereInput[] = [];
  if (query.status) conditions.push(paymentStatusWhere(query.status, now));
  if (query.search) {
    const contains = { contains: query.search, mode: 'insensitive' as const };
    conditions.push({
      OR: [
        { externalPaymentId: contains },
        { phoneNumber: contains },
        { customer: { fullName: contains } },
        { customer: { phoneNumber: contains } },
        { serviceCategory: { name: contains } },
        { job: { is: { description: contains } } },
        { job: { is: { reference: contains } } },
      ],
    });
  }
  return {
    ...(conditions.length ? { AND: conditions } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.serviceCategoryId
      ? { serviceCategoryId: query.serviceCategoryId }
      : {}),
    ...(query.requestType ? { requestType: query.requestType } : {}),
    ...(from || to
      ? {
          paidAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) },
        }
      : {}),
  };
}
