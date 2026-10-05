import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { decryptAesGcm, encryptAesGcm, encryptionKeyFromHex } from '../common/crypto/aes-gcm';

// Encrypts national IDs and creates a keyed digest for exact duplicate checks.
@Injectable()
export class NationalIdCryptoService {
  constructor(private readonly config: ConfigService) {}

  // Encrypts normalized national ID text using authenticated AES-256-GCM.
  encrypt(value: string): string {
    return encryptAesGcm(this.normalize(value), this.getKey());
  }

  // Decrypts an AES-GCM national-ID value stored in the database.
  decrypt(value: string): string {
    const key = this.getKey();
    try {
      return decryptAesGcm(value, key);
    } catch {
      throw new ServiceUnavailableException('Stored national ID data is invalid.');
    }
  }

  // Creates a keyed digest so the plaintext ID is never indexed or searchable.
  hash(value: string): string {
    return createHmac('sha256', this.getKey())
      .update('fundi:national-id:v1:')
      .update(this.normalize(value))
      .digest('hex');
  }

  // Uses the same normalization for encryption and duplicate detection.
  private normalize(value: string): string {
    return value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase();
  }

  // Requires a 32-byte secret only when national-ID encryption is used. Distinguished
  // from a corrupt stored value, so a missing key is never reported as bad data.
  private getKey(): Buffer {
    try {
      return encryptionKeyFromHex(
        this.config.get<string>('security.nationalIdEncryptionKey'),
        'NATIONAL_ID_ENCRYPTION_KEY',
      );
    } catch {
      throw new ServiceUnavailableException(
        'National ID encryption is not configured. Set NATIONAL_ID_ENCRYPTION_KEY to 64 hexadecimal characters.',
      );
    }
  }
}