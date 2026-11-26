import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PagedQueryDto } from './paged-query.dto';
import { MAX_SEARCH_LENGTH } from './pagination.constants';

export enum SortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class AdminListQueryDto extends PagedQueryDto {
  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description: 'Case-insensitive substring search.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder;
}
