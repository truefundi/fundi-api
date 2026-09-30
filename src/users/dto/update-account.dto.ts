import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// Allows profile edits while intentionally omitting role and status fields.
export class UpdateAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value)
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(/^\+?[0-9]+$/)
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;
}