import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import type { TechnicianResponse } from '../technicians.service';

// Envelope returned by the technician list endpoints: one page of profiles
// plus pagination metadata — the same shape GET /users returns.
export class PaginatedTechniciansResponseDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: 'Technician profiles matching the query for the requested page.',
  })
  data!: TechnicianResponse[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: 'Pagination metadata for the query.',
  })
  pagination!: PaginationMetaDto;
}
