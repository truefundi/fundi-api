import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Authenticated AES-256-GCM, shared by every value that has to be readable again.
//
// A password hash cannot be reused here. TOTP secrets and national IDs both have to
// be decrypted server-side, so they are encrypted at rest rather than hashed, and
// they need a key kept apart from the one used for password hashing.

// Format is iv.authTag.ciphertext, each base64, so the whole payload is one column.
export function encryptAesGcm(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

// Throws when the payload is malformed or the key is wrong. The auth tag makes a
// wrong key fail here rather than returning garbage.
export function decryptAesGcm(payload: string, key: Buffer): string {
  const [ivText, tagText, ciphertextText] = payload.split('.');
  if (!ivText || !tagText || !ciphertextText) {
    throw new Error('Stored encrypted value is malformed.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// Requires a 32-byte hexadecimal secret. Rejects rather than padding, so a
// misconfigured environment fails loudly instead of silently using a weak key.
export function encryptionKeyFromHex(value: string | undefined, envVarName: string): Buffer {
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${envVarName} must be set to 64 hexadecimal characters.`);
  }
  return Buffer.from(value, 'hex');
}