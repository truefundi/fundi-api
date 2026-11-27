import { IsUUID } from 'class-validator';

export class ChatReadDto {
  @IsUUID()
  messageId!: string;
}
