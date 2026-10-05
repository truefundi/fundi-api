import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  decryptAesGcm,
  encryptAesGcm,
  encryptionKeyFromHex,
} from '../common/crypto/aes-gcm';

// Encrypts TOTP secrets at rest.
//
// Unlike a password, a TOTP secret cannot be hashed: the server has to read it back
// to compute the code it expects. It is therefore stored encrypted, under a key held
// separately from the password-hashing salt and from the token secrets.
@Injectable()
export class TotpCryptoService {
  constructor(private readonly config: ConfigService) {}

  encrypt(secret: string): string {
    return encryptAesGcm(secret, this.getKey());
  }

  decrypt(payload: string): string {
    const key = this.getKey();
    try {
      return decryptAesGcm(payload, key);
    } catch {
      // A wrong key fails the auth tag here, so this also covers a rotated or
      // mismatched key rather than only a corrupt column.
      throw new ServiceUnavailableException(
        'Stored authenticator data is invalid. It may have been encrypted with a different key.',
      );
    }
  }

  private getKey(): Buffer {
    try {
      return encryptionKeyFromHex(
        this.config.get<string>('security.totpEncryptionKey'),
        'ADMIN_TOTP_ENCRYPTION_KEY',
      );
    } catch {
      throw new ServiceUnavailableException(
        'Authenticator encryption is not configured. Set ADMIN_TOTP_ENCRYPTION_KEY to 64 hexadecimal characters.',
      );
    }
  }
}