import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class RatingItemScoreDto {
  @IsUUID('4')
  itemId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;
}

export class CreateJobRatingDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((response: RatingItemScoreDto) => response.itemId)
  @ValidateNested({ each: true })
  @Type(() => RatingItemScoreDto)
  responses!: RatingItemScoreDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}

export class UpdateJobRatingDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique((response: RatingItemScoreDto) => response.itemId)
  @ValidateNested({ each: true })
  @Type(() => RatingItemScoreDto)
  responses?: RatingItemScoreDto[];

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  comment?: string | null;
}
