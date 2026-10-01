import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Provides the OTP delivery boundary; development prints codes to the API terminal.
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private configService: ConfigService) {}

  // Logs the OTP only in development and refuses unsafe production delivery.
  async sendOtp(phoneNumber: string, otp: string): Promise<void> {
    const mode = this.configService.get<string>('sms.mode', 'console');
    if (mode !== 'console') {
      throw new ServiceUnavailableException('SMS provider is not configured for this environment.');
    }
    const ttlSeconds = this.configService.get<number>('otp.ttlSeconds', 300);
    this.logger.warn(
      `Development OTP for ${phoneNumber}: ${otp} (expires in ${Math.round(ttlSeconds / 60)} minutes)`,
    );
  }
}