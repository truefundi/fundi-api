import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CONVERSATION_MAX_MESSAGE_LENGTH } from '../conversation.constants';

// Responding to an offer may include a short reason, which is kept on the
// conversation when the responder declines.
export class RespondOfferDto {
  @ApiProperty({
    required: false,
    maxLength: CONVERSATION_MAX_MESSAGE_LENGTH,
    example: 'That is above my budget.',
    description: 'Optional reason, stored when the offer is declined.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(CONVERSATION_MAX_MESSAGE_LENGTH)
  reason?: string;
}
