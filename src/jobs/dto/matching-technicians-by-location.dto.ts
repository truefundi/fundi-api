import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class MatchingTechniciansByLocationDto {
  @IsUUID('4')
  serviceCategoryId!: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null
      ? value
      : (Array.isArray(value) ? value : [value]).map((location) =>
          typeof location === 'string' ? location.trim() : location,
        ),
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(200, { each: true })
  locations?: string[] | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === '' ? null : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === '' ? null : Number(value),
  )
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number | null;
}
