import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Validates the six-digit code from an authenticator app. Regex only checks the
// shape; whether the code is current is decided against the enrolled secret.
export class VerifyAdminTwoFactorDto {
  @ApiProperty({
    example: '123456',
    description: 'The six-digit code currently shown by the authenticator app.',
    pattern: '^\\d{6}$',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}