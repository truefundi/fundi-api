import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { SmsModule } from '../sms/sms.module';
import { AdminBroadcastsController } from './admin-broadcasts.controller';
import { BroadcastsService } from './broadcasts.service';

// Administrator broadcasts delivered through the notification inbox and SMS.
@Module({
  imports: [NotificationsModule, SmsModule],
  controllers: [AdminBroadcastsController],
  providers: [BroadcastsService, RolesGuard],
})
export class BroadcastsModule {}
