import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    description: 'Display name for the service.',
    minLength: 2,
    maxLength: 60,
    example: 'Plumbing',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiProperty({
    description: 'ID of the active parent category this service belongs to.',
    format: 'uuid',
    example: '84cfa9af-05d4-40c1-ad36-123e412ec509',
  })
  @IsUUID('4')
  categoryId!: string;

  @ApiPropertyOptional({
    description: 'Customer-facing description of the service.',
    maxLength: 2000,
    example: 'Leak repairs, pipe fitting, and drain unblocking.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Optional comma-separated search keywords for this service.',
    maxLength: 500,
    example: 'leak repair, pipes, blocked drain',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  keywords?: string;

  @ApiPropertyOptional({
    description: 'Optional icon identifier for the service.',
    maxLength: 80,
    nullable: true,
    example: 'wrench',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/i)
  icon?: string | null;

  @ApiPropertyOptional({
    description: 'Standard booking/visit fee in RWF (non-negative integer).',
    minimum: 0,
    maximum: 2_000_000_000,
    example: 1000,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  bookingFee?: number;

  @ApiPropertyOptional({
    description: 'Emergency visit fee in RWF (non-negative integer).',
    minimum: 0,
    maximum: 2_000_000_000,
    example: 1500,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  emergencyVisitFee?: number;

  @ApiPropertyOptional({
    description:
      'SOS booking fee in RWF. If provided, it must be a positive integer and greater than the normal booking fee.',
    minimum: 1,
    maximum: 2_000_000_000,
    nullable: true,
    example: 2500,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  sosBookingFee?: number | null;

  @ApiPropertyOptional({
    description: 'Whether the service is active and available for selection.',
    example: true,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateServiceDto {
  @ApiPropertyOptional({
    description: 'Updated display name for the service.',
    minLength: 2,
    maxLength: 60,
    example: 'Plumbing',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({
    description: 'Move the service to a different active parent category.',
    format: 'uuid',
    example: '84cfa9af-05d4-40c1-ad36-123e412ec509',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Updated service description.',
    maxLength: 2000,
    example: 'Leak repairs, pipe fitting, drain unblocking, and fixture installation.',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Updated search keywords (comma-separated).',
    maxLength: 500,
    example: 'leak repair, pipes, blocked drain, faucets',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  keywords?: string;

  @ApiPropertyOptional({
    description: 'Updated icon identifier. Set to null to clear.',
    maxLength: 80,
    nullable: true,
    example: 'wrench',
  })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/i)
  icon?: string | null;

  @ApiPropertyOptional({
    description: 'Updated standard booking/visit fee in RWF.',
    minimum: 0,
    maximum: 2_000_000_000,
    example: 1000,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  bookingFee?: number;

  @ApiPropertyOptional({
    description: 'Updated emergency visit fee in RWF.',
    minimum: 0,
    maximum: 2_000_000_000,
    example: 1500,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  emergencyVisitFee?: number;

  @ApiPropertyOptional({
    description:
      'Updated SOS booking fee in RWF. If provided, must be a positive integer and greater than the normal booking fee. Set to null to clear.',
    minimum: 1,
    maximum: 2_000_000_000,
    nullable: true,
    example: 2500,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  sosBookingFee?: number | null;

  @ApiPropertyOptional({
    description: 'Whether the service is active and available for selection.',
    example: true,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
