import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PhoneDto } from './phone.dto';
import { FULL_NAME_PATTERN } from '../../common/validation/full-name';

// Defines the identity and non-admin role fields accepted during registration.
export class RegisterDto extends PhoneDto {
  @ApiProperty({
    example: 'Prince Example',
    description:
      "The account holder's full name. Unicode letters, spaces, apostrophes, and hyphens only.",
    minLength: 2,
    maxLength: 120,
  })
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : value,
  )
  @MinLength(2)
  @MaxLength(120)
  @Matches(FULL_NAME_PATTERN)
  fullName!: string;

  @ApiProperty({
    example: 'secure-password',
    description:
      'Optional account password. Use 8–72 characters; passwords are stored as bcrypt hashes.',
    minLength: 8,
    maxLength: 72,
    required: false,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password?: string;

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
    description:
      'Optional role. `ADMIN` cannot be granted through this route. Uppercased automatically.',
    enum: ['CUSTOMER', 'TECHNICIAN'],
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsIn(['CUSTOMER', 'TECHNICIAN'])
  role?: 'CUSTOMER' | 'TECHNICIAN';
}
