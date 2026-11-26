import { ApiProperty } from '@nestjs/swagger';
import { BookingPaymentStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';

export class AdminPaymentPageDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Payment list fields, currency, customer, serviceCategory and linked job. job.assignmentHistory contains at most the latest assignment. Omits signatures, payment keys and pricing snapshots. Status reflects expiry at request time.',
  })
  data!: object[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

export class PaymentStatusTotalDto {
  @ApiProperty({ enum: BookingPaymentStatus })
  status!: BookingPaymentStatus;

  @ApiProperty({ example: 12 })
  count!: number;

  @ApiProperty({ example: 12000 })
  amount!: number;
}

export class AdminPaymentSummaryDto {
  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 12000 })
  amount!: number;

  @ApiProperty({ example: 'RWF' })
  currency!: string;

  @ApiProperty({ type: [PaymentStatusTotalDto] })
  byStatus!: PaymentStatusTotalDto[];

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
}
