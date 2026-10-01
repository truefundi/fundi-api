import { ApiProperty } from '@nestjs/swagger';
import { AuthUserDto } from './auth-user.dto';

// Returned by POST /auth/verify-otp and POST /auth/refresh.
export class AuthTokensDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;

  @ApiProperty({
    description:
      'Short-lived bearer token. Send it as `Authorization: Bearer <accessToken>` to protected routes.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature',
  })
  accessToken!: string;

  @ApiProperty({
    description:
      'Long-lived token used to obtain a new pair from `/auth/refresh`. Single use: it is revoked on exchange or on logout.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature',
  })
  refreshToken!: string;
}