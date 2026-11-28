import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

export class AdminJobPageDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Lightweight rows: id, reference, description, service/serviceCategory, location, customer, currentTechnician, status, priority, requestType, offeredAmount, currency, timestamps, bookingPayment (amount/status), dispute (id/resolvedAt). Histories, offers, media and full rating details are available from GET /admin/jobs/:id.',
  })
  data!: object[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
