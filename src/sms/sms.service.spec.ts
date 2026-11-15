import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';

describe('SmsService', () => {
  const createService = (
    values: Record<string, string> = {
      'sms.mode': 'console',
      environment: 'development',
    },
  ) => {
    const config = {
      get: jest.fn((key: string, fallback: unknown) => values[key] ?? fallback),
    };
    return new SmsService(config as unknown as ConfigService);
  };

  it('allows console OTP delivery in development', async () => {
    const service = createService();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(
      service.sendOtp('+250788123456', '123456'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Development OTP for +250788123456: 123456'),
    );

    warn.mockRestore();
  });

  it('refuses to log OTPs when the environment is production', async () => {
    const service = createService({
      'sms.mode': 'console',
      environment: 'production',
    });

    expect(() => service.ensureOtpDeliveryAvailable()).toThrow(
      ServiceUnavailableException,
    );
    await expect(service.sendOtp('+250788123456', '123456')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects unsupported SMS providers before an OTP can be sent', async () => {
    const service = createService({
      'sms.mode': 'provider',
      environment: 'production',
    });

    expect(() => service.ensureOtpDeliveryAvailable()).toThrow(
      ServiceUnavailableException,
    );
  });
});
