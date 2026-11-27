import { Injectable, Logger } from '@nestjs/common';
import { Namespace } from 'socket.io';

export function chatSocketRoom(roomId: string) {
  return `chat:${roomId}`;
}

export function chatUserSocketRoom(userId: string) {
  return `chat-user:${userId}`;
}

@Injectable()
export class ChatRealtimeService {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private namespace?: Namespace;

  bind(namespace: Namespace) {
    this.namespace = namespace;
  }

  async removeUserFromRoom(userId: string, roomId: string) {
    if (!this.namespace) {
      this.logger.warn(
        `Cannot remove account ${userId} from chat room ${roomId}; chat Socket.IO namespace is not initialized.`,
      );
      return;
    }
    await this.namespace
      .in(chatUserSocketRoom(userId))
      .socketsLeave(chatSocketRoom(roomId));
  }

  publish(
    roomId: string,
    event: string,
    payload: unknown,
    exceptSocketId?: string,
  ) {
    if (!this.namespace) {
      this.logger.warn(
        `Cannot emit ${event}; chat Socket.IO namespace is not initialized.`,
      );
      return;
    }
    const target = this.namespace.to(chatSocketRoom(roomId));
    (exceptSocketId ? target.except(exceptSocketId) : target).emit(
      event,
      payload,
    );
  }
}
