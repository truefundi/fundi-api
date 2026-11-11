import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../common/dto/paged-query.dto';
import { MAX_SEARCH_LENGTH } from '../../common/dto/pagination.constants';
import {
  MAX_CATEGORY_LENGTH,
  MAX_QUERY_LENGTH,
  MAX_YEARS_OF_EXPERIENCE,
} from './list-query.constants';

// Validates the optional query parameters on the discovery endpoints
// (/technicians, /technicians/approved, /public/technicians). Verification
// and account filters are deliberately absent: those endpoints always
// constrain results to approved, active technician accounts server-side.
// Paging (`page`, `limit`) is inherited from the shared PagedQueryDto.
export class SearchAvailableTechniciansDto extends PagedQueryDto {
  @ApiProperty({
    description: 'Exact service category UUID (v4) to filter by.',
    example: '3f1d2a44-6f0e-4a86-9d2b-8f7f3f1f9c21',
  })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiProperty({
    description:
      'Service category name or slug, case-insensitive. Alternative to categoryId for callers that only know the display name.',
    example: 'Plumbing',
    maxLength: MAX_CATEGORY_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The category query parameter must not be empty.' })
  @MaxLength(MAX_CATEGORY_LENGTH)
  category?: string;

  // Free text over name, addresses, and service names — the same sweep the
  // admin search `query` parameter performs, minus contact details.
  @ApiProperty({
    description:
      'Free-text search over names, addresses, and service names. Contact details and coordinates are excluded on these public-facing endpoints.',
    example: 'plumber near Kimihurura',
    maxLength: MAX_QUERY_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The query parameter must not be empty.' })
  @MaxLength(MAX_QUERY_LENGTH)
  query?: string;

  @ApiProperty({
    description:
      'Free-text match against the technician base address or public location label.',
    example: 'Kicukiro',
    maxLength: MAX_SEARCH_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The location query parameter must not be empty.' })
  @MaxLength(MAX_SEARCH_LENGTH)
  location?: string;

  @ApiProperty({
    description: 'Minimum years of experience, inclusive.',
    example: 3,
    minimum: 0,
    maximum: MAX_YEARS_OF_EXPERIENCE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_YEARS_OF_EXPERIENCE)
  minYearsOfExperience?: number;
}
