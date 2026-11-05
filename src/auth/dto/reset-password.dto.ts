import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VerifyOtpDto } from './verify-otp.dto';

export class ResetPasswordDto extends VerifyOtpDto {
  @ApiProperty({ example: 'new-secure-password', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;
}
