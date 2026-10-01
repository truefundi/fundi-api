import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PhoneDto } from './phone.dto';

// Defines the identity and non-admin role fields accepted during registration.
export class RegisterDto extends PhoneDto {
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
    example: 'prince@example.com',
    description: 'Optional email address. Stored as `null` when omitted.',
    format: 'email',
    maxLength: 254,
    required: false,
  })
  @IsOptional()
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
  @Transform(({ value }) => typeof value === 'string' ? value.toUpperCase() : value)
  @IsIn(['CUSTOMER', 'TECHNICIAN'])
  role?: 'CUSTOMER' | 'TECHNICIAN';
}