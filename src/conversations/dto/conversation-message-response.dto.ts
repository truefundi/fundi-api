import { ConversationMessageType, ConversationSender } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { PriceOfferResponseDto } from './price-offer-response.dto';

// One entry in a conversation: the service request, a text note, or an offer.
export class ConversationMessageResponseDto {
  @ApiProperty({ example: '9d3a1f7b-2c44-4e8a-b1d2-3f4a5b6c7d8e' })
  id!: string;

  @ApiProperty({ nullable: true, example: '9c1f4d2e-7a3b-4c8e-9f10-2b5d6e8a1c34' })
  senderId!: string | null;

  @ApiProperty({ enum: Object.values(ConversationSender), example: 'CUSTOMER' })
  senderRole!: ConversationSender;

  @ApiProperty({
    enum: Object.values(ConversationMessageType),
    example: 'PRICE_OFFER',
  })
  type!: ConversationMessageType;

  @ApiProperty({ nullable: true, example: 'Can you do it for less?' })
  text!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Snapshot data for SERVICE_REQUEST entries.',
    example: null,
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-10-16T12:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ type: PriceOfferResponseDto, nullable: true })
  offer!: PriceOfferResponseDto | null;
}
