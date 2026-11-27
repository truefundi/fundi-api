import { BadRequestException } from '@nestjs/common';
import { ChatMessageType } from '@prisma/client';
import {
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_VIDEO_MAX_BYTES,
  CHAT_VIDEO_MAX_SECONDS,
  CHAT_VOICE_MAX_BYTES,
  CHAT_VOICE_MAX_SECONDS,
} from './chat.constants';
import { mp4DurationSeconds } from '../jobs/job-media.util';

export interface ChatUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export interface ValidatedChatUpload {
  mimeType: string;
  extension: string;
  sizeBytes: number;
  durationSeconds: number | null;
}

export function validateChatUpload(
  upload: ChatUpload,
  type: ChatMessageType,
  declaredDurationSeconds?: number,
): ValidatedChatUpload {
  const { buffer } = upload;
  if (!buffer.length)
    throw new BadRequestException('The chat attachment is empty.');

  const extension = fileExtension(upload.originalname);
  let mimeType: string;
  let maxBytes: number;
  let durationSeconds: number | null = null;
  let allowedExtensions: string[];

  if (type === ChatMessageType.IMAGE) {
    maxBytes = CHAT_IMAGE_MAX_BYTES;
    const detected = imageType(buffer);
    if (!detected) {
      throw new BadRequestException(
        'Images must be valid JPEG, PNG, WebP, or GIF files.',
      );
    }
    ({ mimeType, extensions: allowedExtensions } = detected);
  } else if (type === ChatMessageType.FILE) {
    maxBytes = CHAT_DOCUMENT_MAX_BYTES;
    const detected = documentType(buffer);
    if (!detected) {
      throw new BadRequestException(
        'Documents must be valid PDF, Word DOC, or Word DOCX files.',
      );
    }
    ({ mimeType, extensions: allowedExtensions } = detected);
  } else if (type === ChatMessageType.VOICE_NOTE) {
    maxBytes = CHAT_VOICE_MAX_BYTES;
    const detected = audioType(buffer);
    if (!detected) {
      throw new BadRequestException(
        'Voice notes must be valid MP3, WAV, OGG, WebM, or M4A audio.',
      );
    }
    ({ mimeType, extensions: allowedExtensions } = detected);
    durationSeconds = declaredDurationSeconds ?? null;
    if (
      durationSeconds !== null &&
      (durationSeconds <= 0 || durationSeconds > CHAT_VOICE_MAX_SECONDS)
    ) {
      throw new BadRequestException(
        'Voice notes must be five minutes or shorter.',
      );
    }
  } else if (type === ChatMessageType.VIDEO) {
    maxBytes = CHAT_VIDEO_MAX_BYTES;
    const detected = videoType(buffer);
    if (!detected) {
      throw new BadRequestException(
        'Videos must be valid MP4 or WebM files no longer than 60 seconds.',
      );
    }
    ({ mimeType, extensions: allowedExtensions, durationSeconds } = detected);
  } else {
    throw new BadRequestException('This message type does not accept a file.');
  }

  if (buffer.length > maxBytes) {
    throw new BadRequestException(
      `This attachment exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit.`,
    );
  }
  if (!allowedExtensions.includes(extension)) {
    throw new BadRequestException(
      `The file extension does not match the detected ${mimeType} content.`,
    );
  }
  const declaredMimeType = upload.mimetype.split(';')[0].trim().toLowerCase();
  if (declaredMimeType && declaredMimeType !== mimeType) {
    throw new BadRequestException(
      `The declared file type does not match the detected ${mimeType} content.`,
    );
  }

  return {
    mimeType,
    extension,
    sizeBytes: buffer.length,
    durationSeconds,
  };
}

export function safeChatFileName(value: string): string {
  const baseName = value.split(/[\\/]/).pop() ?? 'attachment';
  return (
    baseName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 255) || 'attachment'
  );
}

function fileExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function imageType(
  bytes: Buffer,
): { mimeType: string; extensions: string[] } | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'] };
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { mimeType: 'image/png', extensions: ['png'] };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extensions: ['webp'] };
  }
  if (
    bytes.length >= 6 &&
    ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
  ) {
    return { mimeType: 'image/gif', extensions: ['gif'] };
  }
  return null;
}

function documentType(
  bytes: Buffer,
): { mimeType: string; extensions: string[] } | null {
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') {
    return { mimeType: 'application/pdf', extensions: ['pdf'] };
  }
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  ) {
    return { mimeType: 'application/msword', extensions: ['doc'] };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes.includes(Buffer.from('word/document.xml'))
  ) {
    return {
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extensions: ['docx'],
    };
  }
  return null;
}

function audioType(
  bytes: Buffer,
): { mimeType: string; extensions: string[] } | null {
  if (
    bytes.length >= 4 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return { mimeType: 'audio/wav', extensions: ['wav'] };
  }
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS') {
    return { mimeType: 'audio/ogg', extensions: ['ogg', 'oga'] };
  }
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') {
    return { mimeType: 'audio/mpeg', extensions: ['mp3'] };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return { mimeType: 'audio/mpeg', extensions: ['mp3'] };
  }
  if (isMp4(bytes)) {
    return { mimeType: 'audio/mp4', extensions: ['m4a', 'mp4'] };
  }
  if (isWebm(bytes)) {
    return { mimeType: 'audio/webm', extensions: ['webm'] };
  }
  return null;
}

function videoType(bytes: Buffer): {
  mimeType: string;
  extensions: string[];
  durationSeconds: number;
} | null {
  if (isMp4(bytes)) {
    const durationSeconds = mp4DurationSeconds(bytes);
    if (
      durationSeconds === null ||
      durationSeconds <= 0 ||
      durationSeconds > CHAT_VIDEO_MAX_SECONDS
    ) {
      return null;
    }
    return { mimeType: 'video/mp4', extensions: ['mp4'], durationSeconds };
  }
  if (isWebm(bytes)) {
    const durationSeconds = webmDurationSeconds(bytes);
    if (
      durationSeconds === null ||
      durationSeconds <= 0 ||
      durationSeconds > CHAT_VIDEO_MAX_SECONDS
    ) {
      return null;
    }
    return {
      mimeType: 'video/webm',
      extensions: ['webm'],
      durationSeconds,
    };
  }
  return null;
}

function isMp4(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp';
}

function isWebm(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  );
}

function webmDurationSeconds(bytes: Buffer): number | null {
  const segmentId = Buffer.from([0x18, 0x53, 0x80, 0x67]);
  const segmentOffset = bytes.indexOf(segmentId);
  if (segmentOffset < 0) return null;
  const segment = readElement(bytes, segmentOffset);
  if (!segment || segment.id !== 0x18538067) return null;

  const segmentEnd = segment.unknownSize
    ? bytes.length
    : Math.min(segment.end, bytes.length);
  let offset = segment.dataStart;
  while (offset < segmentEnd) {
    const element = readElement(bytes, offset);
    if (!element || element.end <= offset) return null;
    if (element.id === 0x1549a966) {
      return durationFromInfo(bytes, element.dataStart, element.end);
    }
    offset = element.unknownSize ? segmentEnd : element.end;
  }
  return null;
}

function durationFromInfo(
  bytes: Buffer,
  start: number,
  end: number,
): number | null {
  let timecodeScale = 1_000_000;
  let durationValue: number | null = null;
  let offset = start;
  while (offset < end) {
    const element = readElement(bytes, offset);
    if (!element || element.unknownSize || element.end > end) return null;
    if (element.id === 0x2ad7b1) {
      const integer = readUnsignedInteger(
        bytes,
        element.dataStart,
        element.end - element.dataStart,
      );
      if (integer === null || integer <= 0) return null;
      timecodeScale = integer;
    } else if (element.id === 0x4489) {
      const length = element.end - element.dataStart;
      if (length === 4) durationValue = bytes.readFloatBE(element.dataStart);
      if (length === 8) durationValue = bytes.readDoubleBE(element.dataStart);
    }
    offset = element.end;
  }
  if (
    durationValue === null ||
    !Number.isFinite(durationValue) ||
    durationValue <= 0
  ) {
    return null;
  }
  return (durationValue * timecodeScale) / 1_000_000_000;
}

interface EbmlElement {
  id: number;
  dataStart: number;
  end: number;
  unknownSize: boolean;
}

function readElement(bytes: Buffer, offset: number): EbmlElement | null {
  const id = readVint(bytes, offset, true);
  if (!id) return null;
  const size = readVint(bytes, offset + id.length, false);
  if (!size) return null;
  const dataStart = offset + id.length + size.length;
  if (size.unknown) {
    return {
      id: Number(id.value),
      dataStart,
      end: bytes.length,
      unknownSize: true,
    };
  }
  if (size.value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const end = dataStart + Number(size.value);
  if (end > bytes.length) return null;
  return { id: Number(id.value), dataStart, end, unknownSize: false };
}

function readVint(
  bytes: Buffer,
  offset: number,
  isId: boolean,
): { value: bigint; length: number; unknown: boolean } | null {
  if (offset >= bytes.length || bytes[offset] === 0) return null;
  const first = bytes[offset];
  let marker = 0x80;
  let length = 1;
  while ((first & marker) === 0) {
    marker >>= 1;
    length += 1;
    if (length > (isId ? 4 : 8)) return null;
  }
  if (offset + length > bytes.length) return null;
  let value = BigInt(isId ? first : first & (marker - 1));
  for (let index = 1; index < length; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index]);
  }
  const unknown = !isId && value === (1n << BigInt(7 * length)) - 1n;
  return { value, length, unknown };
}

function readUnsignedInteger(
  bytes: Buffer,
  offset: number,
  length: number,
): number | null {
  if (length < 1 || length > 8) return null;
  let value = 0n;
  for (let index = offset; index < offset + length; index += 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
