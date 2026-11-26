import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebSocketsModule } from '../websockets/websockets.module';
import { PaymentProvidersController } from './payment-providers.controller';
import { PaymentProvidersService } from './payment-providers.service';
import { PaymentEventsService } from './payment-events.service';
import { MobilePaymentsService } from './mobile-payments.service';

@Module({
  imports: [DatabaseModule, AuditModule, NotificationsModule, WebSocketsModule],
  controllers: [PaymentsController, PaymentProvidersController],
  providers: [
    PaymentsService,
    PaymentProvidersService,
    PaymentEventsService,
    MobilePaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
