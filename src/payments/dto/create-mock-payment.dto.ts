import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsEnum,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { JobRequestType } from '@prisma/client';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

export class CreateMockPaymentDto {
  @IsUUID('4')
  serviceCategoryId!: string;

  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;

  @IsOptional()
  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber?: string;
}
