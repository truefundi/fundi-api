import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  encryptAesGcm,
  encryptionKeyFromHex,
} from '../common/crypto/aes-gcm';

@Injectable()
export class NationalIdCryptoService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): string {
    return encryptAesGcm(this.normalize(value), this.getKey());
  }

  hash(value: string): string {
    return createHmac('sha256', this.getKey())
      .update('fundi:technician-national-id:v1:')
      .update(this.normalize(value))
      .digest('hex');
  }

  lastFour(value: string): string {
    return this.normalize(value).slice(-4);
  }

  private normalize(value: string): string {
    return value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase();
  }

  private getKey(): Buffer {
    try {
      return encryptionKeyFromHex(
        this.config.get<string>('security.nationalIdEncryptionKey'),
        'NATIONAL_ID_ENCRYPTION_KEY',
      );
    } catch {
      throw new ServiceUnavailableException(
        'Technician ID encryption is not configured. Set NATIONAL_ID_ENCRYPTION_KEY to 64 hexadecimal characters.',
      );
    }
  }
}
