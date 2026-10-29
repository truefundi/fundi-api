import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminDisputesController } from './admin-disputes.controller';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

// Dispute lifecycle: the parties open a dispute on a job, the admin reviews and
// decides it. Disputes belong to jobs; the modules above own the job and chat reads.
@Module({
  imports: [DatabaseModule, AuditModule, JobsModule, ConversationsModule, NotificationsModule],
  controllers: [AdminDisputesController, DisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
