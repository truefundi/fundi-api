import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { StorageModule } from '../storage/storage.module';
import { AdminChatController } from './admin-chat.controller';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';

@Module({
  imports: [
    JwtModule.register({}),
    DatabaseModule,
    AuditModule,
    JobsModule,
    StorageModule,
  ],
  controllers: [ChatController, AdminChatController],
  providers: [ChatService, ChatRealtimeService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
