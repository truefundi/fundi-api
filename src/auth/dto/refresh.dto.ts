import { IsJWT, IsString } from 'class-validator';

// Validates the refresh JWT that the refresh endpoint exchanges for a new pair.
export class RefreshDto {
  @IsString()
  @IsJWT()
  refreshToken!: string;
}