import { ConversationStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PagedQueryDto } from '../../common/dto/paged-query.dto';
import { MAX_SEARCH_LENGTH } from '../../common/dto/pagination.constants';

// Query for the admin conversation list. Paging is inherited from PagedQueryDto.
export class ListConversationsQueryDto extends PagedQueryDto {
  @ApiProperty({
    required: false,
    enum: Object.values(ConversationStatus),
    example: 'NEGOTIATING',
    description: 'Only return conversations in this negotiation state.',
  })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @ApiProperty({
    required: false,
    type: 'string',
    example: 'HVAC',
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Substring matched against the service, problem, customer, and technician.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The search query parameter must not be empty.' })
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;
}
