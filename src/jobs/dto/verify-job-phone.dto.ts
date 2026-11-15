import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class VerifyJobPhoneDto {
  @IsUUID('4')
  verificationId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  otp!: string;
}
