import { BadRequestException } from '@nestjs/common';
import {
  JobRequestType,
  Prisma,
  ServiceChargePayer,
  ServiceChargeType,
} from '@prisma/client';

export interface ServiceChargeForPricing {
  id: string;
  name: string;
  description: string | null;
  chargeType: ServiceChargeType;
  value: number | string | { toString(): string };
  payer: ServiceChargePayer;
  sortOrder: number;
}

export interface ServiceForPricing {
  id: string;
  name: string;
  slug?: string;
  visitFee: number;
  sosBookingFee: number | null;
  serviceCharges: ServiceChargeForPricing[];
}

export type PaymentPricingQuote = Prisma.InputJsonObject & {
  serviceCategory: { id: string; name: string };
  requestType: JobRequestType;
  currency: 'RWF';
  baseFee: number;
  charges: Array<{
    id: string;
    name: string;
    description: string | null;
    chargeType: ServiceChargeType;
    value: number;
    payer: ServiceChargePayer;
    amount: number;
  }>;
  customerTotal: number;
  fundiTotal: number;
  total: number;
}

export function calculatePaymentQuote(
  service: ServiceForPricing,
  requestType: JobRequestType,
): PaymentPricingQuote {
  const baseFee =
    requestType === JobRequestType.SOS
      ? service.sosBookingFee
      : service.visitFee;
  if (baseFee === null || baseFee <= 0) {
    throw new BadRequestException(
      `This service does not have a valid ${requestType} booking fee configured.`,
    );
  }

  const charges = service.serviceCharges.map((charge) => {
    const value = Number(charge.value);
    const amount =
      charge.chargeType === ServiceChargeType.PERCENTAGE
        ? Math.round((baseFee * value) / 100)
        : value;

    return {
      id: charge.id,
      name: charge.name,
      description: charge.description,
      chargeType: charge.chargeType,
      value,
      payer: charge.payer,
      amount,
    };
  });
  const customerTotal =
    baseFee +
    charges
      .filter((charge) => charge.payer === ServiceChargePayer.CUSTOMER)
      .reduce((total, charge) => total + charge.amount, 0);
  const fundiTotal = charges
    .filter((charge) => charge.payer === ServiceChargePayer.FUNDI)
    .reduce((total, charge) => total + charge.amount, 0);

  return {
    serviceCategory: { id: service.id, name: service.name },
    requestType,
    currency: 'RWF',
    baseFee,
    charges,
    customerTotal,
    fundiTotal,
    total: customerTotal + fundiTotal,
  };
}
