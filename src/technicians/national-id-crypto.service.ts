import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

// Encrypts national IDs and creates a keyed digest for exact duplicate checks.
@Injectable()
export class NationalIdCryptoService {
  constructor(private readonly config: ConfigService) {}

  // Encrypts normalized national ID text using authenticated AES-256-GCM.
  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(this.normalize(value), 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64'))
      .join('.');
  }

  // Decrypts an AES-GCM national-ID value stored in the database.
  decrypt(value: string): string {
    const [ivText, tagText, ciphertextText] = value.split('.');
    if (!ivText || !tagText || !ciphertextText) {
      throw new ServiceUnavailableException('Stored national ID data is invalid.');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getKey(),
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
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

  // Requires a 32-byte secret only when national-ID encryption is used.
  private getKey(): Buffer {
    const encoded = this.config.get<string>('security.nationalIdEncryptionKey');
    if (!encoded || !/^[0-9a-fA-F]{64}$/.test(encoded)) {
      throw new ServiceUnavailableException(
        'National ID encryption is not configured. Set NATIONAL_ID_ENCRYPTION_KEY to 64 hexadecimal characters.',
      );
    }
    return Buffer.from(encoded, 'hex');
  }
}