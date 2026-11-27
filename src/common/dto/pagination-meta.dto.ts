import { ApiProperty } from '@nestjs/swagger';

// Pagination metadata returned alongside every paginated list response.
export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: 'Requested page number, 1-based.' })
  page!: number;

  @ApiProperty({ example: 20, description: 'Requested page size.' })
  limit!: number;

  @ApiProperty({
    example: 100,
    description: 'Total records matching the query across all pages.',
  })
  total!: number;

  @ApiProperty({
    example: 5,
    description: 'Total pages available for the query.',
  })
  totalPages!: number;
}
