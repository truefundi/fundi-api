import { IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

export class VerifyJobPhoneDto {
  @IsUUID('4')
  verificationId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp!: string;
}

/** Optional number to send the job verification code to instead of the account's. */
export class RequestJobPhoneVerificationDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;
}
