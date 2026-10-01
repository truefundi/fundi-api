import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// Allows profile edits while intentionally omitting role and status fields.
export class UpdateAccountDto {
  @ApiProperty({
    example: 'Prince N. Example',
    description:
      "New full name. Surrounding whitespace is trimmed before validation, so a blank name is rejected. Omit to leave the current value unchanged.",
    minLength: 2,
    maxLength: 120,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @ApiProperty({
    example: '+250788999000',
    description:
      'New phone number. Spaces, parentheses, and hyphens are stripped before validation. Must not already belong to another account.',
    minLength: 7,
    maxLength: 20,
    pattern: '^\\+?[0-9]+$',
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value)
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(/^\+?[0-9]+$/)
  phoneNumber?: string;

  @ApiProperty({
    example: 'prince@example.com',
    description:
      'New email address. Trimmed and lowercased before validation, so casing and padding never create a duplicate account. Send an empty string to clear the stored email.',
    format: 'email',
    maxLength: 254,
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toLowerCase();
    // An empty string clears the email, and `null` is what skips the email check.
    return normalized === '' ? null : normalized;
  })
  @IsEmail()
  @MaxLength(254)
  email?: string | null;
}