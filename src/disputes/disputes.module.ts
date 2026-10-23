import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { DatabaseModule } from '../database/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { AdminDisputesController } from './admin-disputes.controller';
import { DisputesService } from './disputes.service';

// Admin-side dispute review. Disputes belong to jobs; this module only adds the
// list/detail/resolve endpoints and delegates job and chat reads to their owners.
@Module({
  imports: [DatabaseModule, AuditModule, JobsModule, ConversationsModule],
  controllers: [AdminDisputesController],
  providers: [DisputesService],
})
export class DisputesModule {}
