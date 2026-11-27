import { StreamableFile } from '@nestjs/common';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export const DOCUMENT_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  'application/pdf',
] as const;

// The parts of a multer upload this feature uses.
export interface UploadedFileData {
  buffer: Buffer;
  originalname: string;
  size: number;
}

export interface DetectedFile {
  mime: (typeof DOCUMENT_MIME_TYPES)[number];
  extension: 'jpg' | 'png' | 'webp' | 'pdf';
}

// Identifies a file from its first bytes so a spoofed Content-Type or extension is never trusted.
export function detectFileType(bytes: Buffer): DetectedFile | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
    return { mime: 'application/pdf', extension: 'pdf' };
  }
  return null;
}

// Wraps stored bytes as a download response with a safe Content-Disposition header.
export function toStreamableFile(file: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): StreamableFile {
  const asciiName = file.fileName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  return new StreamableFile(file.buffer, {
    type: file.mimeType,
    length: file.buffer.length,
    disposition: `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  });
}
