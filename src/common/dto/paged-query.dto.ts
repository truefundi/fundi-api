import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_PAGE, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination.constants';

// Shared page/limit parameters so every list endpoint pages the same way.
export class PagedQueryDto {
  @ApiProperty({
    required: false,
    type: 'integer',
    default: DEFAULT_PAGE,
    minimum: 1,
    example: 1,
    description: 'Page number, 1-based. Defaults to 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({
    required: false,
    type: 'integer',
    default: DEFAULT_PAGE_LIMIT,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    example: 20,
    description: `Rows per page, between 1 and ${MAX_PAGE_LIMIT}. Defaults to ${DEFAULT_PAGE_LIMIT}.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}
