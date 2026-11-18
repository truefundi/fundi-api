import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { JobRequestType, PaymentClaimMethod } from '@prisma/client';

export class CreatePaymentClaimDto {
  @IsUUID('4')
  serviceCategoryId!: string;

  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  amount!: number;

  @IsEnum(PaymentClaimMethod)
  paymentMethod!: PaymentClaimMethod;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  paymentNumber!: string;
}
