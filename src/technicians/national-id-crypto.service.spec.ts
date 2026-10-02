import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NationalIdCryptoService } from './national-id-crypto.service';

// Verifies national IDs are normalized, encrypted, and compared through keyed hashes.
describe('NationalIdCryptoService', () => {
  const key = '0123456789abcdef'.repeat(4);

  // Creates the crypto service with an isolated test key.
  const createService = (configuredKey = key) =>
    new NationalIdCryptoService({
      get: jest.fn(() => configuredKey),
    } as unknown as ConfigService);

  // Ensures national IDs can be recovered after authenticated encryption.
  it('encrypts and decrypts normalized national IDs', () => {
    const service = createService();
    const encrypted = service.encrypt(' ab-123 456 ');
    expect(encrypted).not.toContain('AB123456');
    expect(service.decrypt(encrypted)).toBe('AB123456');
  });

  // Ensures formatting variants produce the same duplicate-detection digest.
  it('hashes formatting-equivalent IDs to the same digest', () => {
    const service = createService();
    expect(service.hash('ab-123 456')).toBe(service.hash('AB123456'));
  });

  // Fails clearly if the national-ID encryption key is absent or malformed.
  it('requires a 32-byte hexadecimal key', () => {
    const service = createService('not-a-key');
    expect(() => service.encrypt('AB123456')).toThrow(
      ServiceUnavailableException,
    );
  });
});
