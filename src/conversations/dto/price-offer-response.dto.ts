import { PriceOfferStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

// A price offer or counter-offer inside a conversation.
export class PriceOfferResponseDto {
  @ApiProperty({ example: '2f1c8a4e-6c31-4a5b-9d0e-1b2c3d4e5f60' })
  id!: string;

  @ApiProperty({ example: 25000, description: 'Offered price in RWF.' })
  amount!: number;

  @ApiProperty({ example: 'RWF' })
  currency!: string;

  @ApiProperty({ enum: ['CUSTOMER', 'TECHNICIAN'], example: 'TECHNICIAN' })
  senderRole!: 'CUSTOMER' | 'TECHNICIAN';

  @ApiProperty({ enum: Object.values(PriceOfferStatus), example: 'PENDING' })
  status!: PriceOfferStatus;

  @ApiProperty({ nullable: true, example: 'Includes parts.' })
  notes!: string | null;

  @ApiProperty({ nullable: true, example: '2026-10-17T12:00:00.000Z' })
  expiresAt!: Date | null;

  @ApiProperty({ nullable: true, example: null })
  respondedAt!: Date | null;

  @ApiProperty({ example: '2026-10-16T12:00:00.000Z' })
  createdAt!: Date;
}
