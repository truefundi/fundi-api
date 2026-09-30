import { IsJWT, IsString } from 'class-validator';

// Validates the refresh JWT that logout will revoke.
export class LogoutDto {
  @IsString()
  @IsJWT()
  refreshToken!: string;
}