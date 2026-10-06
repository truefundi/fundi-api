import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class ServiceExperienceDto {
  @ValidateIf((o) => !o.customName)
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ValidateIf((o) => !o.categoryId)
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  customName?: string;

  @IsInt()
  @Min(0)
  @Max(60)
  yearsOfExperience!: number;
}