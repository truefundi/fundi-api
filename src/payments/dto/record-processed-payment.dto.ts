import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { JobRequestType } from '@prisma/client';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

export class RecordProcessedPaymentDto {
  @IsUUID('4')
  serviceCategoryId!: string;

  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  externalPaymentId!: string;

  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  amount!: number;

  @IsIn(['SUCCESS'])
  status!: 'SUCCESS';

  @IsDateString()
  paidAt!: string;
}
