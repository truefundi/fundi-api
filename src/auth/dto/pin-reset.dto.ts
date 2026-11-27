import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerifyOtpDto } from './verify-otp.dto';

const PIN = /^\d{4,6}$/;

/** A forgotten PIN: the SMS code proves the phone, then the new PIN replaces the old. */
export class ResetPinDto extends VerifyOtpDto {
  @ApiProperty({
    example: '24680',
    description: 'The new 4–6 digit PIN.',
    minLength: 4,
    maxLength: 6,
    format: 'password',
  })
  @IsString()
  @Matches(PIN, { message: 'PINs must contain 4 to 6 digits.' })
  newPin!: string;
}

/** A signed-in user changing their PIN. */
export class ChangePinDto {
  @ApiPropertyOptional({
    example: '13579',
    description:
      'The PIN in use now. Required when the account already has a PIN.',
    format: 'password',
  })
  @IsOptional()
  @IsString()
  @Matches(PIN, { message: 'PINs must contain 4 to 6 digits.' })
  currentPin?: string;

  @ApiProperty({
    example: '24680',
    description: 'The new 4–6 digit PIN.',
    minLength: 4,
    maxLength: 6,
    format: 'password',
  })
  @IsString()
  @Matches(PIN, { message: 'PINs must contain 4 to 6 digits.' })
  newPin!: string;
}
