import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminConversationsController } from './admin-conversations.controller';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// The price-negotiation phase of a job: one conversation per job, opened when
// the request is sent, held until the assigned technician responds, then closed
// once a price is agreed or the negotiation ends. Job-core keeps ownership of
// the job lifecycle; declining a request delegates back to it.
@Module({
  imports: [DatabaseModule, AuditModule, JobsModule, NotificationsModule],
  controllers: [ConversationsController, AdminConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
