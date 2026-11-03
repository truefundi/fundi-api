import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  CHAT_PAGE_SIZE_DEFAULT,
  CHAT_PAGE_SIZE_MAX,
  CHAT_TEXT_MAX_LENGTH,
} from '../chat.constants';

export class ListChatMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CHAT_PAGE_SIZE_MAX)
  limit = CHAT_PAGE_SIZE_DEFAULT;

  @IsOptional()
  @IsUUID()
  beforeMessageId?: string;
}

export class CreateChatTextMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_TEXT_MAX_LENGTH)
  text!: string;
}

export class UpdateChatTextMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_TEXT_MAX_LENGTH)
  text!: string;
}
