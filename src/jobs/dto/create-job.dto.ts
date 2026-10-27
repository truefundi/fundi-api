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

export class CreateJobDto {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description:
      'Service category ID from the catalog. Provide this or otherServiceName, not both.',
  })
  @IsOptional()
  @IsUUID('4')
  serviceCategoryId?: string;

  @ApiProperty({
    required: false,
    minLength: 2,
    maxLength: 80,
    description:
      'Free-text service when the work does not fit a catalog category. Provide this or serviceCategoryId, not both.',
    example: 'Solar water heater repair',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  otherServiceName?: string;

  @ApiProperty({
    minLength: 10,
    maxLength: 5000,
    description: 'What needs fixing, in the customer’s own words.',
    example: 'The kitchen sink has been leaking under the cabinet since yesterday.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiProperty({
    minLength: 3,
    maxLength: 255,
    description: 'Where the technician should go.',
    example: 'Kimironko, Gasabo',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  locationAddress!: string;

  @ApiProperty({
    type: 'number',
    minimum: -90,
    maximum: 90,
    description: 'Latitude of the job location. Used for dispatch distance.',
    example: -1.9441,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    type: 'number',
    minimum: -180,
    maximum: 180,
    description: 'Longitude of the job location. Used for dispatch distance.',
    example: 30.0619,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2_000_000_000,
    description:
      'Amount the customer offers for the visit/repair, in the job currency (RWF).',
    example: 20000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_000_000_000)
  offeredAmount!: number;

  @ApiProperty({
    required: false,
    enum: JobPriority,
    default: JobPriority.NORMAL,
    description: 'How urgently the job should be dispatched.',
  })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;
}
