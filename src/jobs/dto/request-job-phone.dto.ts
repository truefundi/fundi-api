import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

export class RequestJobPhoneDto {
  @ApiProperty({
    required: false,
    example: '+250788123456',
    description:
      'Optional Rwandan mobile number to verify. If omitted, verifies the account phone number.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber?: string;
}
