import { JobRequestType } from '@prisma/client';
import { createHmac } from 'crypto';

export function signBookingPayment(
  secret: string,
  id: string,
  externalPaymentId: string,
  customerId: string,
  serviceCategoryId: string,
  amount: number,
  phoneNumber: string,
  paidAt: Date,
  requestType: JobRequestType,
  pricingSnapshot: unknown = null,
) {
  return createHmac('sha256', secret)
    .update(
      [
        id,
        externalPaymentId,
        customerId,
        serviceCategoryId,
        requestType,
        amount,
        phoneNumber,
        paidAt.toISOString(),
        JSON.stringify(pricingSnapshot),
      ].join(':'),
    )
    .digest('hex');
}
