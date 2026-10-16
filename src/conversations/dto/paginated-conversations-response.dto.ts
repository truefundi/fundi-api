import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { ConversationResponseDto } from './conversation-response.dto';

// Envelope returned by GET /admin/conversations.
export class PaginatedConversationsResponseDto {
  @ApiProperty({
    type: [ConversationResponseDto],
    description: 'Conversations for the requested page.',
  })
  data!: ConversationResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}
