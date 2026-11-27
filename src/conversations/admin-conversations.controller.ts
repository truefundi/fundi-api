import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth } from '../common/decorators/auth.decorator';
import { ConversationsService } from './conversations.service';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { PaginatedConversationsResponseDto } from './dto/paginated-conversations-response.dto';

@ApiTags('Admin conversations')
@Controller('api/v1/admin/conversations')
@Auth(UserRole.ADMIN)
export class AdminConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List price-negotiation conversations (admin only)',
    description:
      'Read-only. Customers and technicians write the messages in the app; the ' +
      'admin observes, and can filter by status and search.',
  })
  @ApiResponse({ status: 200, type: PaginatedConversationsResponseDto })
  list(@Query() query: ListConversationsQueryDto) {
    return this.conversations.listForAdmin(query);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Read one conversation (admin only)' })
  @ApiResponse({ status: 200, type: ConversationResponseDto })
  get(@Param('conversationId', ParseUUIDPipe) conversationId: string) {
    return this.conversations.getForAdmin(conversationId);
  }
}
