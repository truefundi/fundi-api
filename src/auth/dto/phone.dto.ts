import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

// Validates and normalizes phone numbers used to look up an account.
export class PhoneDto {
  @ApiProperty({
    example: '+250788123456',
    description:
      'Rwandan mobile number in local format (078, 079, 072, or 073 followed by seven digits) or international +250 format. Local numbers are normalized to +250 format; spaces, parentheses, and hyphens are stripped.',
  })
  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber!: string;
}