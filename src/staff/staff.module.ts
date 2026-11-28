import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccessModule } from './access.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [AccessModule, AuditModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
