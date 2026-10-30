import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AdminUpdateJobDto {
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  locationAddress?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  offeredAmount?: number;
}
