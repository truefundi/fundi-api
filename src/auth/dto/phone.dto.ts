import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Validates and normalizes phone numbers used to look up an account.
export class PhoneDto {
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
}