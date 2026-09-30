import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';

// Exposes the SMS delivery service to authentication workflows.
@Module({ providers: [SmsService], exports: [SmsService] })
export class SmsModule {}