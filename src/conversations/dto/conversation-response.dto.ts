import { ConversationStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { ConversationMessageResponseDto } from './conversation-message-response.dto';
import { PriceOfferResponseDto } from './price-offer-response.dto';

export class ConversationPartyDto {
  @ApiProperty({ example: '9c1f4d2e-7a3b-4c8e-9f10-2b5d6e8a1c34' })
  id!: string;

  @ApiProperty({ example: 'Jean Ndayisaba' })
  fullName!: string;

  @ApiProperty({ example: '+250733762239' })
  phoneNumber!: string;
}

// The request that opened the conversation, taken from the job.
export class ConversationRequestDto {
  @ApiProperty({ nullable: true, example: 'HVAC' })
  service!: string | null;

  @ApiProperty({ example: 'Air conditioner makes a loud noise at night' })
  description!: string;

  @ApiProperty({ example: 'Kimihurura, Kigali' })
  locationAddress!: string;

  @ApiProperty({ example: -1.9536 })
  latitude!: number;

  @ApiProperty({ example: 30.0606 })
  longitude!: number;
}

// The single price-negotiation conversation attached to a job.
export class ConversationResponseDto {
  @ApiProperty({ example: 'f0ab9447-04fb-40f6-86aa-e714de851825' })
  id!: string;

  @ApiProperty({ example: 'a497ee8b-205a-4f5c-9e8a-6352f2207bd4' })
  jobId!: string;

  @ApiProperty({ enum: Object.values(ConversationStatus), example: 'NEGOTIATING' })
  status!: ConversationStatus;

  @ApiProperty({ example: 'RWF' })
  currency!: string;

  @ApiProperty({
    nullable: true,
    example: 25000,
    description: 'The price the two sides agreed on, set when status is AGREED.',
  })
  agreedAmount!: number | null;

  @ApiProperty({ example: 2, description: 'Offers posted so far.' })
  offerCount!: number;

  @ApiProperty({ nullable: true })
  declinedById!: string | null;

  @ApiProperty({ nullable: true, example: 'That is above my budget.' })
  declineReason!: string | null;

  @ApiProperty({ example: '2026-10-16T12:00:00.000Z' })
  startedAt!: Date;

  @ApiProperty({ example: '2026-10-16T12:04:00.000Z' })
  lastMessageAt!: Date;

  @ApiProperty({ nullable: true, example: null })
  closedAt!: Date | null;

  @ApiProperty({ type: ConversationRequestDto })
  request!: ConversationRequestDto;

  @ApiProperty({ type: ConversationPartyDto })
  customer!: ConversationPartyDto;

  @ApiProperty({ type: ConversationPartyDto, nullable: true })
  technician!: ConversationPartyDto | null;

  @ApiProperty({ type: PriceOfferResponseDto, nullable: true })
  currentOffer!: PriceOfferResponseDto | null;

  @ApiProperty({ type: [ConversationMessageResponseDto] })
  messages!: ConversationMessageResponseDto[];
}
