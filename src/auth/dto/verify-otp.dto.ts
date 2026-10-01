import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PhoneDto } from './phone.dto';

// Validates the six-digit OTP submitted for a phone-number login.
export class VerifyOtpDto extends PhoneDto {
  @ApiProperty({
    example: '123456',
    description: 'The six-digit code from the most recent OTP message.',
    pattern: '^\\d{6}$',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}