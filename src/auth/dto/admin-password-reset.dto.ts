import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RequestAdminPasswordResetDto {
  @ApiProperty({
    example: 'admin@fundi.rw',
    description: 'The administrator email address.',
    format: 'email',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;
}

export class VerifyAdminPasswordResetDto extends RequestAdminPasswordResetDto {
  @ApiProperty({
    example: '123456',
    description: 'The six-digit OTP sent to the administrator phone number.',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}

export class ResetAdminPasswordDto extends RequestAdminPasswordResetDto {
  @ApiProperty({
    description:
      'Short-lived, single-use reset authorization returned after the OTP is verified.',
    format: 'password',
  })
  @IsString()
  @MinLength(36)
  @MaxLength(36)
  resetToken!: string;

  @ApiProperty({
    example: 'NewAdmin@456',
    description:
      'At least 8 characters, including an uppercase letter, a number, and a non-alphanumeric character. At most 72 characters.',
    format: 'password',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[A-Z]/, {
    message: 'newPassword must contain at least one uppercase letter',
  })
  @Matches(/\d/, {
    message: 'newPassword must contain at least one number',
  })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'newPassword must contain at least one non-alphanumeric character',
  })
  newPassword!: string;
}
