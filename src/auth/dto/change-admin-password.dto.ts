import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

// Changing a password requires proving the current one. The new password follows the
// same rules the sign-in DTO enforces, so an account can never be left holding a
// password that `/auth/admin/login` would reject.
export class ChangeAdminPasswordDto {
  @ApiProperty({
    example: 'Admin@123',
    description: 'The password currently in use.',
    format: 'password',
    maxLength: 72,
  })
  @IsString()
  @MaxLength(72)
  currentPassword!: string;

  @ApiProperty({
    example: 'NewAdmin@456',
    description:
      'At least 8 characters, including at least one uppercase letter, one number, and one non-alphanumeric character. At most 72, because bcrypt ignores anything beyond its 72-byte limit.',
    format: 'password',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/[A-Z]/, { message: 'newPassword must contain at least one uppercase letter' })
  @Matches(/\d/, { message: 'newPassword must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'newPassword must contain at least one non-alphanumeric character',
  })
  newPassword!: string;
}
