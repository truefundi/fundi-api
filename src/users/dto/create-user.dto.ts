import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { UserRole, UserStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

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
      'Phone number, preferably in international format. Spaces, parentheses, and hyphens are stripped before validation.',
    minLength: 7,
    maxLength: 20,
    pattern: '^\\+?[0-9]+$',
  })
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value)
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(/^\+?[0-9]+$/)
  phoneNumber!: string;

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