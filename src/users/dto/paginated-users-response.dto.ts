import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { UserResponseDto } from './user-response.dto';

// Re-exported so existing imports keep working from this module.
export { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

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
