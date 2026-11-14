import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({
    description: 'Display name for the parent category.',
    minLength: 2,
    maxLength: 60,
    example: 'Home Services',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    description: 'Short description shown to administrators and clients.',
    minLength: 2,
    maxLength: 2000,
    example: 'Repairs and maintenance for homes.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  description!: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({
    description: 'Updated display name for the parent category.',
    minLength: 2,
    maxLength: 60,
    example: 'Home Services',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated category description.',
    minLength: 2,
    maxLength: 2000,
    example: 'Repairs, installations, and maintenance for homes.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Whether the category is active and visible in public listings.',
    example: true,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
