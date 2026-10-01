import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Makes each onboarding field optional so technicians can save the wizard progressively.
export class UpdateTechnicianProfileDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  yearsOfExperience?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  tin?: string;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value) ? [...new Set(value)] : value,
  )
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  baseAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  baseLatitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  baseLongitude?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  serviceRadiusKm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  onboardingStep?: number;
}
