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

// Returned by POST /auth/admin/login when the administrator already has an
// authenticator enrolled. No token is present: until the code is checked there is
// nothing to hand out.
export class AdminTwoFactorRequiredDto {
  @ApiProperty({ example: 'Enter the 6-digit code from your authenticator app.' })
  message!: string;

  @ApiProperty({
    example: false,
    description: 'False once an authenticator is enrolled on the account.',
  })
  enrollmentRequired!: boolean;

  @ApiProperty({
    example: 300,
    description: 'Seconds the sign-in stays open waiting for the code.',
  })
  expiresInSeconds!: number;
}

// Returned by the same route on the very first sign-in, instead. The two
// otpauth fields carry the shared secret: the dashboard turns `otpauthUri` into a QR
// code, and `secret` is there for anyone who cannot scan. Both are sent with
// Cache-Control: no-store, and both are worthless once the first code is accepted
// and the enrolment window closes.
export class AdminTwoFactorEnrollDto {
  @ApiProperty({
    example: 'Scan this with your authenticator app, then enter the 6-digit code it shows.',
  })
  message!: string;

  @ApiProperty({
    example: true,
    description: 'True until an authenticator is enrolled on the account.',
  })
  enrollmentRequired!: boolean;

  @ApiProperty({
    example: 300,
    description: 'Seconds the enrolment stays open waiting for the first code.',
  })
  expiresInSeconds!: number;

  @ApiProperty({
    example:
      'otpauth://totp/Fundi:admin%40fundi.rw?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&algorithm=SHA1&issuer=Fundi',
    description:
      'The otpauth:// URI to render as a QR code. The issuer must match in both the label and the query parameter or authenticator apps reject the scan.',
  })
  otpauthUri!: string;

  @ApiProperty({
    example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    description: 'The same shared secret in plain base32, for manual entry.',
  })
  secret!: string;
}

// Returned by /2fa/verify and /refresh. The tokens travel in httpOnly cookies and
// are never included here.
export class AdminSessionDto {
  @ApiProperty({ type: AdminUserDto })
  user!: AdminUserDto;

  @ApiProperty({ example: 900, description: 'Seconds until the access cookie expires.' })
  expiresInSeconds!: number;
}