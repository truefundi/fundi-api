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
import { JobProgressDto } from '../jobs/dto/job-action.dto';
import { ChatService } from './chat.service';
import { AdminChatBlockDto, ChatReasonDto } from './dto/chat-action.dto';
import {
  CreateChatTextMessageDto,
  ListChatMessagesDto,
  UpdateChatTextMessageDto,
} from './dto/list-chat-messages.dto';
import { PostChatMediaDto } from './dto/post-chat-media.dto';
import { ChatReadDto } from './dto/chat-read.dto';
import { ChatUpload } from './chat-media.util';
import { CHAT_VIDEO_MAX_BYTES } from './chat.constants';

@ApiTags('Job chat')
@Controller('api/v1/chat')
@Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('rooms')
  listRooms(@CurrentUser() user: AuthUser) {
    return this.chat.listForMember(user.id);
  }

  @Get('rooms/:roomId')
  getRoom(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.chat.getForMember(user.id, user.role, roomId);
  }

  @Get('rooms/:roomId/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() query: ListChatMessagesDto,
  ) {
    return this.chat.listMessages(
      user.id,
      user.role,
      roomId,
      query.limit,
      query.beforeMessageId,
    );
  }

  @Post('rooms/:roomId/messages')
  postText(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: CreateChatTextMessageDto,
  ) {
    return this.chat.postText(user.id, user.role, roomId, dto.text);
  }

  @Post('rooms/:roomId/messages/media')
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
  @ApiOperation({
    summary: 'Send a voice note, image, document, or short video',
  })
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
      user.role,
      roomId,
      dto.type,
      file,
      dto.durationSeconds,
    );
  }

  @Get('rooms/:roomId/messages/:messageId/media')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
  downloadMedia(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chat.downloadMedia(user.id, user.role, roomId, messageId);
  }

  @Post('rooms/:roomId/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: ChatReadDto,
  ) {
    return this.chat.markRead(user.id, user.role, roomId, dto.messageId);
  }

  @Patch('rooms/:roomId/messages/:messageId')
  editText(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: UpdateChatTextMessageDto,
  ) {
    return this.chat.editText(user.id, user.role, roomId, messageId, dto.text);
  }

  @Delete('rooms/:roomId/messages/:messageId')
  deleteUnreadMessage(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.chat.deleteUnreadMessage(user.id, user.role, roomId, messageId);
  }

  @Delete('rooms/:roomId')
  archiveRoom(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.chat.archiveRoom(user.id, roomId);
  }

  @Post('rooms/:roomId/cooperation/confirm')
  confirmCooperation(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.chat.confirmCooperation(user.id, roomId);
  }

  @Post('rooms/:roomId/cooperation/deny')
  denyPartnership(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: ChatReasonDto,
  ) {
    return this.chat.denyPartnership(user.id, roomId, dto.reason);
  }

  @Post('rooms/:roomId/cancel')
  cancelJob(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: ChatReasonDto,
  ) {
    return this.chat.cancelJob(user.id, roomId, dto.reason);
  }

  @Patch('rooms/:roomId/progress')
  updateProgress(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: JobProgressDto,
  ) {
    return this.chat.updateProgress(user.id, roomId, dto.status);
  }

  @Post('rooms/:roomId/pause')
  pause(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.chat.requestPause(user.id, roomId);
  }

  @Post('rooms/:roomId/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.chat.requestResume(user.id, roomId);
  }
}
