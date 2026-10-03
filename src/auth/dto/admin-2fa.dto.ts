import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Validates the six-digit code from the admin second-factor SMS.
export class VerifyAdminTwoFactorDto {
  @ApiProperty({
    example: '123456',
    description: 'The six-digit code from the most recent two-factor message.',
    pattern: '^\\d{6}$',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}