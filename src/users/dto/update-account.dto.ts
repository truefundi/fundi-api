import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';
import { FULL_NAME_PATTERN } from '../../common/validation/full-name';

// Allows profile edits while intentionally omitting role and status fields.
export class UpdateAccountDto {
  @ApiProperty({
    example: 'Prince N. Example',
    description: 'New full name. Omit to leave the current value unchanged.',
    minLength: 2,
    maxLength: 120,
    required: false,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value,
  )
  @MinLength(2)
  @MaxLength(120)
  @Matches(FULL_NAME_PATTERN)
  fullName?: string;

  @ApiProperty({
    example: '+250788999000',
    description:
      'New Rwandan mobile number: local format (078, 079, 072, or 073 followed by seven digits) or international +250 format. Local numbers are normalized to +250 format. Must not already belong to another account.',
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber?: string;

  @ApiProperty({
    example: 'prince@example.com',
    description:
      'New email address. Send an empty string to clear the stored email.',
    format: 'email',
    maxLength: 254,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;
}
