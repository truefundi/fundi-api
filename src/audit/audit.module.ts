import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RolesGuard } from '../auth/roles.guard';
import { AdminAuditLogsController } from './admin-audit-logs.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AdminAuditLogsController],
  providers: [AuditService, RolesGuard],
  exports: [AuditService],
})
export class AuditModule {}
