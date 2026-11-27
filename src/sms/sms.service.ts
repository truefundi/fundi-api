import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Provides the OTP delivery boundary; development prints codes to the API terminal.
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private configService: ConfigService) {}

  // Logs the OTP only in development and refuses unsafe production delivery.
  async sendOtp(phoneNumber: string, otp: string): Promise<void> {
    this.ensureOtpDeliveryAvailable();
    const ttlSeconds = this.configService.get<number>('otp.ttlSeconds', 300);
    this.logger.warn(
      `Development OTP for ${phoneNumber}: ${otp} (expires in ${Math.round(ttlSeconds / 60)} minutes)`,
    );
  }

  // Allows callers to fail before account lookup or OTP creation when delivery
  // cannot succeed, keeping reset-request responses independent of account state.
  ensureOtpDeliveryAvailable(): void {
    const mode = this.configService.get<string>('sms.mode', 'console');
    const environment = this.configService.get<string>(
      'environment',
      'development',
    );
    if (mode !== 'console' || environment !== 'development') {
      throw new ServiceUnavailableException(
        'SMS provider is not configured for this environment.',
      );
    }
  }

  // Delivers an administrator broadcast. Kept separate from OTP delivery so the two
  // messages cannot be confused, and so a future provider can give them different
  // sender IDs. The console driver is the only configured transport today.
  async sendMessage(phoneNumber: string, message: string): Promise<void> {
    this.ensureOtpDeliveryAvailable();
    this.logger.log(`Development SMS to ${phoneNumber}: ${message}`);
  }
}
