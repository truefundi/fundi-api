import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Address of the administrator to sign in as. Same normalisation as the password
// step, so `Admin@fundi.rw ` and `admin@fundi.rw` reach the same account.
export class AdminDevOtpRequestDto {
  @ApiProperty({
    example: 'admin@fundi.rw',
    description: 'The admin account email address. Trimmed and lowercased before matching.',
    format: 'email',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;
}

// The address again, plus the code the request step returned to the caller.
export class AdminDevOtpVerifyDto extends AdminDevOtpRequestDto {
  @ApiProperty({
    example: '123456',
    description: 'The six-digit code returned by `POST /api/v1/auth/admin/dev/otp`.',
    pattern: '^\\d{6}$',
    minLength: 6,
    maxLength: 6,
  })
  @IsString()
  @Matches(/^\d{6}$/)
  otp!: string;
}
