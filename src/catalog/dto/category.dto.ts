import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
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
  @IsBoolean()
  isActive?: boolean;
}

// Validates editable category fields; an empty update is rejected by the service.
export class UpdateCategoryDto {
  @IsOptional()
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
}
