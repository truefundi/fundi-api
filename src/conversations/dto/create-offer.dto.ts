import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CONVERSATION_MAX_AMOUNT,
  CONVERSATION_MAX_MESSAGE_LENGTH,
  CONVERSATION_MIN_AMOUNT,
} from '../conversation.constants';

// A price offer or counter-offer. The amount is whole RWF units.
export class CreateOfferDto {
  @ApiProperty({
    example: 25000,
    minimum: CONVERSATION_MIN_AMOUNT,
    maximum: CONVERSATION_MAX_AMOUNT,
    description: 'Offered price in RWF, in whole units.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(CONVERSATION_MIN_AMOUNT)
  @Max(CONVERSATION_MAX_AMOUNT)
  amount!: number;

  @ApiProperty({
    required: false,
    maxLength: CONVERSATION_MAX_MESSAGE_LENGTH,
    example: 'Includes the replacement bracket.',
    description: 'Optional note that goes with the offer.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(CONVERSATION_MAX_MESSAGE_LENGTH)
  notes?: string;
}
