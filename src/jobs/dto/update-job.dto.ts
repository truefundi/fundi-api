import { ApiProperty } from '@nestjs/swagger';
import { JobPriority } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpdateJobDto {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description:
      'Service category ID from the catalog. Changes the service and re-runs dispatch for an unassigned job.',
  })
  @IsOptional()
  @IsUUID('4')
  serviceCategoryId?: string;

  @ApiProperty({
    required: false,
    minLength: 2,
    maxLength: 80,
    description: 'Free-text service name. Changes the service and re-runs dispatch.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  otherServiceName?: string;

  @ApiProperty({ required: false, minLength: 10, maxLength: 5000 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description?: string;

  @ApiProperty({
    required: false,
    minLength: 3,
    maxLength: 255,
    description: 'Where the technician should go.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  locationAddress?: string;

  @ApiProperty({
    required: false,
    type: 'number',
    minimum: -90,
    maximum: 90,
    description: 'Must be sent together with longitude.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiProperty({
    required: false,
    type: 'number',
    minimum: -180,
    maximum: 180,
    description: 'Must be sent together with latitude.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: 1,
    maximum: 2_000_000_000,
    description: 'New amount offered for the job, in the job currency (RWF).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  offeredAmount?: number;

  @ApiProperty({ required: false, enum: JobPriority })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;
}
