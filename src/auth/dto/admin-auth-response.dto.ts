import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

// The admin identity returned with a session. Separate from AuthUserDto because an
// admin signs in by email, not phone, and the dashboard shows the email.
export class AdminUserDto {
  @ApiProperty({ example: '9c1f4d2e-7a3b-4c8e-9f10-2b5d6e8a1c34' })
  id!: string;

  @ApiProperty({ example: 'Alice Mukamana' })
  fullName!: string;

  @ApiProperty({ example: 'admin@fundi.rw', format: 'email' })
  email!: string;

  @ApiProperty({ enum: Object.values(UserRole), example: 'ADMIN' })
  role!: UserRole;
}

// Returned by POST /auth/admin/login once the password is accepted. No token is
// present: until the code is verified there is nothing to hand out.
export class AdminTwoFactorRequiredDto {
  @ApiProperty({ example: 'Verification code sent. It expires in 5 minutes.' })
  message!: string;

  @ApiProperty({
    example: '+250******456',
    description: 'Masked destination the SMS went to, so an admin can spot a wrong number.',
  })
  maskedPhoneNumber!: string;

  @ApiProperty({ example: 300, description: 'Seconds the code stays usable.' })
  expiresInSeconds!: number;
}

// Returned by /2fa/verify and /refresh. The tokens travel in httpOnly cookies and
// are never included here.
export class AdminSessionDto {
  @ApiProperty({ type: AdminUserDto })
  user!: AdminUserDto;

  @ApiProperty({ example: 900, description: 'Seconds until the access cookie expires.' })
  expiresInSeconds!: number;
}