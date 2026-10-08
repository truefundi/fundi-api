import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ListTechniciansQueryDto } from './list-technicians-query.dto';
import { MAX_QUERY_LENGTH } from './list-query.constants';

// Validates admin filters for a multi-field technician search: every list
// filter (paging, search, location, statuses, category, experience) plus the
// broad `query` sweep and the national-ID digest lookup. All supplied filters
// are AND-combined.
export class SearchTechniciansDto extends ListTechniciansQueryDto {
  // Broader than `search`: also matches addresses, service category names,
  // custom service names, and exact numeric coordinates.
  @ApiProperty({
    description:
      'Broad free-text sweep over names, contact details, addresses, service category names, custom service names, and exact numeric coordinates. AND-combined with every other filter.',
    example: 'Kigali plumber',
    maxLength: MAX_QUERY_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUERY_LENGTH)
  query?: string;

  // Normalised to uppercase alphanumerics before it is hashed for lookup.
  @ApiProperty({
    description:
      'National ID in any display format; normalised to uppercase alphanumerics before hashing for exact lookup.',
    example: '1198765430123456',
    minLength: 4,
    maxLength: 64,
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(/^[A-Z0-9]+$/)
  nationalIdNumber?: string;
}
