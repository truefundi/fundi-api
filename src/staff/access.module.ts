import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './permissions.guard';
import { StaffAccessEventsService } from './staff-access-events.service';
import { StaffAccountPolicyService } from './staff-account-policy.service';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    PermissionsService,
    PermissionsGuard,
    StaffAccessEventsService,
    StaffAccountPolicyService,
  ],
  exports: [
    PermissionsService,
    PermissionsGuard,
    StaffAccessEventsService,
    StaffAccountPolicyService,
  ],
})
export class AccessModule {}
