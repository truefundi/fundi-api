import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

// Validates account fields an administrator may set at creation time.
export class CreateUserDto {
  @ApiProperty({
    example: 'Prince Example',
    description: "The account holder's full name.",
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

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

  @ApiProperty({
    example: 'prince@example.com',
    description: 'Optional email address. Stored as `null` when omitted.',
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

  @ApiProperty({
    example: 'CUSTOMER',
    description: 'Optional role. Defaults to `CUSTOMER`.',
    enum: Object.values(UserRole),
    required: false,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiProperty({
    example: 'ACTIVE',
    description: 'Optional status. Defaults to `ACTIVE`.',
    enum: Object.values(UserStatus),
    required: false,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}