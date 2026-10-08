import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto';

// Pagination metadata returned alongside every GET /users page.
export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: 'Requested page number, 1-based.' })
  page!: number;

  @ApiProperty({ example: 20, description: 'Requested page size.' })
  limit!: number;

  @ApiProperty({
    example: 100,
    description: 'Total users matching the query across all pages.',
  })
  total!: number;

  @ApiProperty({
    example: 5,
    description: 'Total pages available for the query.',
  })
  totalPages!: number;
}

// Envelope returned by GET /users: one page of users plus pagination metadata.
export class PaginatedUsersResponseDto {
  @ApiProperty({
    type: [UserResponseDto],
    description: 'Users matching the query for the requested page.',
  })
  data!: UserResponseDto[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: 'Pagination metadata for the query.',
  })
  pagination!: PaginationMetaDto;
}
