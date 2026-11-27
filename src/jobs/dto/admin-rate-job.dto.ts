import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * The customer's post-job rating, recorded by an administrator on their behalf
 * (for example after a dispute). Every category is a whole star from 1 to 5;
 * `overall` is the average shown in the dashboard.
 */
export class AdminRateJobDto {
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  overall!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  quality!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  professionalism!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  arrival!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  communication!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  value!: number;

  @ApiProperty({ required: false, maxLength: 2000, example: 'Fixed the leak quickly.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
