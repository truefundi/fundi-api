import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Validates the credentials for the admin password step. There is no sign-up
// route here: admin accounts are created by the seed script.
export class AdminLoginDto {
  @ApiProperty({
    example: 'Admin@fundi.rw',
    description: 'The admin account email address. Trimmed and lowercased before matching.',
    format: 'email',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'Fundi#Admin2026',
    description:
      'At least 8 characters, including at least one uppercase letter, one number, and one non-alphanumeric character. At most 72, because bcrypt ignores anything beyond its 72-byte limit.',
    format: 'password',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[A-Z]/, { message: 'password must contain at least one uppercase letter' })
  @Matches(/\d/, { message: 'password must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'password must contain at least one non-alphanumeric character',
  })
  password!: string;
}