import { Transform } from 'class-transformer';
import { PaymentClaimStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewPaymentClaimDto {
  @IsIn([PaymentClaimStatus.APPROVED, PaymentClaimStatus.REJECTED])
  status!: PaymentClaimStatus;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}
