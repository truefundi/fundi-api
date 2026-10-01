import { IsJWT, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

// Validates the refresh JWT that the refresh endpoint exchanges for a new pair.
export class RefreshDto {
  @ApiProperty({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMTIzNDU2Ny0xMjM0NTY3ODkwIiwic2lkIjoiLi4uIn0.signature',
    description:
      'The `refreshToken` returned by `/verify-otp` or `/refresh`. Single use: it is revoked on exchange or logout.',
    format: 'JWT',
  })
  @IsString()
  @IsJWT()
  refreshToken!: string;
}