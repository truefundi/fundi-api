import { IsJWT, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Validates the refresh JWT that logout will revoke.
export class LogoutDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMTIzNDU2Ny0xMjM0NTY3ODkwIiwic2lkIjoiLi4uIn0.signature',
    description:
      'The `refreshToken` to revoke. It must belong to the authenticated account, and the access token must still be valid.',
    format: 'JWT',
  })
  @IsString()
  @IsJWT()
  refreshToken!: string;
}