import { BadRequestException, StreamableFile } from '@nestjs/common';
import { JobMediaType } from '@prisma/client';
import {
  JOB_MAX_PHOTO_BYTES,
  JOB_MAX_VIDEO_BYTES,
  JOB_MAX_VIDEO_SECONDS,
} from './job.constants';

export interface JobUpload {
  buffer: Buffer;
  originalname: string;
}

export interface ValidatedJobUpload {
  type: JobMediaType;
  mimeType: string;
  extension: 'jpg' | 'png' | 'webp' | 'mp4';
  durationSeconds: number | null;
}

export function validateJobUploads(
  photos: JobUpload[],
  video?: JobUpload,
): ValidatedJobUpload[] {
  if (photos.length > 5) {
    throw new BadRequestException('A job can include at most five photos.');
  }
  if (photos.length === 0 && !video) return [];

  const validated = photos.map((photo) => validatePhoto(photo));
  if (video) validated.push(validateVideo(video));
  const totalBytes = [...photos, ...(video ? [video] : [])].reduce(
    (total, file) => total + file.buffer.length,
    0,
  );
  if (totalBytes > JOB_MAX_PHOTO_BYTES * 5 + JOB_MAX_VIDEO_BYTES) {
    throw new BadRequestException('The combined job media size is too large.');
  }
  return validated;
}

function validatePhoto(file: JobUpload): ValidatedJobUpload {
  if (!file.buffer.length) {
    throw new BadRequestException('Job photos must not be empty.');
  }
  if (file.buffer.length > JOB_MAX_PHOTO_BYTES) {
    throw new BadRequestException('Each job photo must be 5 MiB or smaller.');
  }
  const bytes = file.buffer;
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return {
      type: JobMediaType.PHOTO,
      mimeType: 'image/png',
      extension: 'png',
      durationSeconds: null,
    };
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return {
      type: JobMediaType.PHOTO,
      mimeType: 'image/jpeg',
      extension: 'jpg',
      durationSeconds: null,
    };
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return {
      type: JobMediaType.PHOTO,
      mimeType: 'image/webp',
      extension: 'webp',
      durationSeconds: null,
    };
  }
  throw new BadRequestException(
    'Job photos must be JPEG, PNG, or WebP images.',
  );
}

function validateVideo(file: JobUpload): ValidatedJobUpload {
  if (!file.buffer.length) {
    throw new BadRequestException('The job video must not be empty.');
  }
  if (file.buffer.length > JOB_MAX_VIDEO_BYTES) {
    throw new BadRequestException('The job video must be 50 MiB or smaller.');
  }
  const durationSeconds = mp4DurationSeconds(file.buffer);
  if (durationSeconds === null) {
    throw new BadRequestException(
      'The job video must be a valid MP4 with a readable duration.',
    );
  }
  if (durationSeconds <= 0 || durationSeconds > JOB_MAX_VIDEO_SECONDS) {
    throw new BadRequestException(
      'The job video must be 30 seconds or shorter.',
    );
  }
  return {
    type: JobMediaType.VIDEO,
    mimeType: 'video/mp4',
    extension: 'mp4',
    durationSeconds,
  };
}

function mp4DurationSeconds(bytes: Buffer): number | null {
  if (bytes.length < 12) return null;
  if (!findBox(bytes, 0, bytes.length, 'ftyp')) return null;
  const topLevel = findBox(bytes, 0, bytes.length, 'moov');
  if (!topLevel) return null;
  const movieHeader = findBox(bytes, topLevel.dataStart, topLevel.end, 'mvhd');
  if (!movieHeader) return null;
  const version = bytes[movieHeader.dataStart];
  const timescaleOffset = movieHeader.dataStart + (version === 1 ? 20 : 12);
  const durationOffset = movieHeader.dataStart + (version === 1 ? 24 : 16);
  if (version !== 0 && version !== 1) return null;
  if (durationOffset + (version === 1 ? 8 : 4) > movieHeader.end) return null;
  const timescale = bytes.readUInt32BE(timescaleOffset);
  const duration =
    version === 1
      ? Number(bytes.readBigUInt64BE(durationOffset))
      : bytes.readUInt32BE(durationOffset);
  if (!Number.isFinite(duration) || duration <= 0 || timescale <= 0)
    return null;
  return duration / timescale;
}

interface Mp4Box {
  dataStart: number;
  end: number;
}

function findBox(
  bytes: Buffer,
  start: number,
  end: number,
  wanted: string,
): Mp4Box | null {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) return null;
      const extendedSize = bytes.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) return null;
    if (type === wanted)
      return { dataStart: offset + headerSize, end: offset + size };
    offset += size;
  }
  return null;
}

export function safeJobFileName(name: string): string {
  const baseName = name.split(/[\\/]/).pop() ?? 'attachment';
  return (
    baseName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 255) || 'attachment'
  );
}

export function toInlineJobMedia(file: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): StreamableFile {
  const name = safeJobFileName(file.fileName);
  return new StreamableFile(file.buffer, {
    type: file.mimeType,
    length: file.buffer.length,
    disposition: `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
}
