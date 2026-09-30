import { IsString, Matches } from 'class-validator';
import { PhoneDto } from './phone.dto';

// Validates the six-digit OTP submitted for a phone-number login.
export class VerifyOtpDto extends PhoneDto {
  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}