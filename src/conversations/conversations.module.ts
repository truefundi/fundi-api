import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { AdminConversationsController } from './admin-conversations.controller';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// The price-negotiation phase of a job: one conversation per job, opened when
// the request is sent, closed once a price is agreed or the negotiation ends.
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [ConversationsController, AdminConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
