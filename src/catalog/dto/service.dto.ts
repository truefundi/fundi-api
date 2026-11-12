import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateServiceDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsUUID('4')
  categoryId!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  keywords?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/i)
  icon?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  bookingFee?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  emergencyVisitFee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  sosBookingFee?: number | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateServiceDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  categoryId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  keywords?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/i)
  icon?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  bookingFee?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  emergencyVisitFee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  sosBookingFee?: number | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
