import { Module } from '@nestjs/common';
import { ChatRealtimeService } from './chat-realtime.service';

/**
 * The chat socket publisher on its own, so services outside the chat module
 * (jobs, for the auto-complete) can push `chat:job:updated` to a room without
 * importing ChatModule, which itself depends on JobsModule.
 */
@Module({
  providers: [ChatRealtimeService],
  exports: [ChatRealtimeService],
})
export class ChatRealtimeModule {}
