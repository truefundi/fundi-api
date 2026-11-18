import { IsEnum, IsOptional } from 'class-validator';
import { PaymentClaimStatus } from '@prisma/client';

export class ListPaymentClaimsDto {
  @IsOptional()
  @IsEnum(PaymentClaimStatus)
  status?: PaymentClaimStatus;
}
