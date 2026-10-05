import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';
import { TechnicianAvailability, TechnicianGender } from '@prisma/client';

// Validates all user and technician fields changed by one atomic profile request.
// Profile pictures are uploaded separately through PUT /api/v1/technicians/profile/picture.
export class UpdateTechnicianProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(/^\+?[0-9]+$/)
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @IsEnum(TechnicianGender)
  gender?: TechnicianGender | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  yearsOfExperience?: number;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(/^[A-Z0-9]+$/)
  nationalIdNumber?: string | null;

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
  baseAddress?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  publicLocationLabel?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsNumber()
  @Min(-90)
  @Max(90)
  baseLatitude?: number | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? value : Number(value),
  )
  @IsNumber()
  @Min(-180)
  @Max(180)
  baseLongitude?: number | null;

  @IsOptional()
  @IsEnum(TechnicianAvailability)
  availabilityStatus?: TechnicianAvailability;
}