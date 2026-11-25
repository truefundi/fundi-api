import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobRequestType, MobilePaymentProvider } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

export class InitiatePaymentDto {
  @ApiProperty({ enum: MobilePaymentProvider })
  @IsEnum(MobilePaymentProvider)
  provider!: MobilePaymentProvider;

  @ApiProperty({ format: 'uuid' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  serviceCategoryId!: string;

  @ApiPropertyOptional({ enum: JobRequestType, default: JobRequestType.NORMAL })
  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;

  @ApiProperty({ example: '+250788123456' })
  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Generate once per payment; reuse on retries.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  @IsUUID('4')
  idempotencyKey!: string;
}
