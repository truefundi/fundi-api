import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Validates the category name accepted when an administrator creates a category.
export class CreateCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // Dashboard grouping, e.g. "Home Services" or "Car Services".
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/i)
  icon?: string | null;

  // Booking (visit) fee in RWF.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  visitFee?: number;

  // Booking fee applied to emergency requests.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  emergencyVisitFee?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  sosBookingFee?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// Validates editable category fields; an empty update is rejected by the service.
export class UpdateCategoryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/i)
  icon?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  visitFee?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  emergencyVisitFee?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  sosBookingFee?: number;
}
