import { ChatMessageType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import {
  CHAT_VIDEO_MAX_SECONDS,
  CHAT_VOICE_MAX_SECONDS,
} from '../chat.constants';

const CHAT_MEDIA_TYPES = [
  ChatMessageType.VOICE_NOTE,
  ChatMessageType.FILE,
  ChatMessageType.IMAGE,
  ChatMessageType.VIDEO,
];

export class PostChatMediaDto {
  @IsIn(CHAT_MEDIA_TYPES)
  type!: ChatMessageType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(CHAT_VOICE_MAX_SECONDS)
  durationSeconds?: number;
}
