import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { ConversationsService } from './conversations.service';
import { ConversationResponseDto } from './dto/conversation-response.dto';
import { CreateOfferDto } from './dto/create-offer.dto';
import { OpenConversationDto } from './dto/open-conversation.dto';
import { PostMessageDto } from './dto/post-message.dto';
import { RespondOfferDto } from './dto/respond-offer.dto';

@ApiTags('Conversations')
@Controller('api/v1/conversations')
@Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Post()
  @ApiOperation({
    summary: 'Open the price-negotiation conversation for a job',
    description:
      'Customer only. Returns the existing conversation for the job if one is ' +
      'already open, so it is safe to call repeatedly. The service request is ' +
      'posted automatically as the first message.',
  })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenConversationDto) {
    return this.conversations.open(user.id, dto.jobId);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Read a conversation (participants only)' })
  @ApiResponse({ status: 200, type: ConversationResponseDto })
  get(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.conversations.get(user.id, conversationId);
  }

  @Post(':conversationId/messages')
  @ApiOperation({ summary: 'Post a short text message (participants only)' })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  postMessage(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: PostMessageDto,
  ) {
    return this.conversations.postMessage(user.id, conversationId, dto);
  }

  @Post(':conversationId/offers')
  @ApiOperation({
    summary: 'Post a price offer or counter-offer (participants only)',
    description:
      'Supersedes the outstanding offer. Rejected once the per-side or overall ' +
      'offer limit is reached.',
  })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  createOffer(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: CreateOfferDto,
  ) {
    return this.conversations.createOffer(user.id, conversationId, dto);
  }

  @Post(':conversationId/offers/:offerId/accept')
  @ApiOperation({
    summary: 'Accept the outstanding offer (participants only)',
    description: 'Agrees the price and closes the conversation.',
  })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  acceptOffer(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.conversations.acceptOffer(user.id, conversationId, offerId);
  }

  @Post(':conversationId/offers/:offerId/decline')
  @ApiOperation({
    summary: 'Decline the outstanding offer (participants only)',
    description: 'Ends the negotiation.',
  })
  @ApiResponse({ status: 201, type: ConversationResponseDto })
  declineOffer(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: RespondOfferDto,
  ) {
    return this.conversations.declineOffer(
      user.id,
      conversationId,
      offerId,
      dto,
    );
  }
}
