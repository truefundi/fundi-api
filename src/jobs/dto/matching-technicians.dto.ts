import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class MatchingTechniciansDto {
  @IsOptional()
  @IsUUID('4')
  serviceCategoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  otherServiceName?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class ProposeTechnicianDto {
  @IsUUID('4')
  technicianId!: string;
}
