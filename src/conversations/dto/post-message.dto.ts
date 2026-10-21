import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CONVERSATION_MAX_MESSAGE_LENGTH } from '../conversation.constants';

// A short free-text message inside the negotiation, alongside the offers.
export class PostMessageDto {
  @ApiProperty({
    maxLength: CONVERSATION_MAX_MESSAGE_LENGTH,
    example: 'Can you do it for less if I buy the parts?',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(CONVERSATION_MAX_MESSAGE_LENGTH)
  text!: string;
}
