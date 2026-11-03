import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { ChatService } from './chat.service';
import { ChatUpload } from './chat-media.util';
import { CHAT_VIDEO_MAX_BYTES } from './chat.constants';
import { AdminChatBlockDto, SetChatRoomStatusDto } from './dto/chat-action.dto';
import {
  CreateChatTextMessageDto,
  ListChatMessagesDto,
} from './dto/list-chat-messages.dto';
import { PostChatMediaDto } from './dto/post-chat-media.dto';

@ApiTags('Admin chat moderation')
@Controller('api/v1/admin/chat/rooms')
@Auth(UserRole.ADMIN)
export class AdminChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  listRooms() {
    return this.chat.listForAdmin();
  }

  @Get(':roomId')
  getRoom(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.chat.getForAdmin(roomId);
  }

  @Get(':roomId/messages')
  listMessages(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: ListChatMessagesDto,
  ) {
    return this.chat.listMessages(
      '',
      UserRole.ADMIN,
      roomId,
      query.limit,
      query.beforeMessageId,
    );
  }

  @Get(':roomId/messages/:messageId/media')
  downloadMedia(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chat.downloadMedia('', UserRole.ADMIN, roomId, messageId);
  }

  @Post(':roomId/messages')
  @ApiOperation({
    summary: 'Send an administrative message, including to a disabled room',
  })
  postText(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateChatTextMessageDto,
  ) {
    return this.chat.postText(user.id, UserRole.ADMIN, roomId, dto.text);
  }

  @Post(':roomId/messages/media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        files: 1,
        fileSize: CHAT_VIDEO_MAX_BYTES,
        fields: 2,
        fieldSize: 1000,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['type', 'file'],
      properties: {
        type: {
          type: 'string',
          enum: ['VOICE_NOTE', 'FILE', 'IMAGE', 'VIDEO'],
        },
        durationSeconds: { type: 'number', maximum: 300 },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  postMedia(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: PostChatMediaDto,
    @UploadedFile() file?: ChatUpload,
  ) {
    if (!file) {
      throw new BadRequestException('Select a chat attachment to upload.');
    }
    return this.chat.postMedia(
      user.id,
      UserRole.ADMIN,
      roomId,
      dto.type,
      file,
      dto.durationSeconds,
    );
  }

  @Patch(':roomId/status')
  setRoomDisabled(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: SetChatRoomStatusDto,
  ) {
    return this.chat.setRoomDisabled(user.id, roomId, dto.disabled, dto.reason);
  }

  @Patch(':roomId/members/:userId')
  setMemberBlocked(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AdminChatBlockDto,
  ) {
    return this.chat.setMemberBlocked(
      user.id,
      roomId,
      userId,
      dto.blocked,
      dto.reason,
    );
  }

  @Patch(':roomId/messages/:messageId/block')
  setMessageBlocked(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: AdminChatBlockDto,
  ) {
    return this.chat.setMessageBlocked(
      user.id,
      roomId,
      messageId,
      dto.blocked,
      dto.reason,
    );
  }

  @Delete(':roomId/messages/:messageId')
  permanentlyDeleteMessage(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chat.permanentlyDeleteMessage(user.id, roomId, messageId);
  }
}
