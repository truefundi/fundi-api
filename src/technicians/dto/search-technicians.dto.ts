import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ListTechniciansQueryDto } from './list-technicians-query.dto';
import { MAX_QUERY_LENGTH } from './list-query.constants';

// Validates admin filters for a multi-field technician search: every list
// filter (paging, search, location, statuses, category, experience) plus the
// broad `query` sweep. All supplied filters are AND-combined.
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
}
