import { BadRequestException } from '@nestjs/common';
import { JobMediaType } from '@prisma/client';
import { JOB_MAX_PHOTO_BYTES } from './job.constants';
import { validateJobUploads } from './job-media.util';

function box(type: string, content: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(content.length + header.length, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, content]);
}

function mp4WithDuration(seconds: number): Buffer {
  const fileType = box('ftyp', Buffer.from('isom0000isom', 'ascii'));
  const movieHeader = Buffer.alloc(20);
  movieHeader.writeUInt32BE(1000, 12);
  movieHeader.writeUInt32BE(seconds * 1000, 16);
  const movie = box('moov', box('mvhd', movieHeader));
  return Buffer.concat([fileType, movie]);
}

describe('job media validation', () => {
  it('accepts a valid short MP4 and records its duration', () => {
    const [video] = validateJobUploads([], {
      originalname: 'repair.mp4',
      buffer: mp4WithDuration(30),
    });

    expect(video).toMatchObject({
      type: JobMediaType.VIDEO,
      mimeType: 'video/mp4',
      extension: 'mp4',
      durationSeconds: 30,
    });
  });

  it('rejects a video longer than 30 seconds', () => {
    expect(() =>
      validateJobUploads([], {
        originalname: 'long.mp4',
        buffer: mp4WithDuration(31),
      }),
    ).toThrow('The job video must be 30 seconds or shorter.');
  });

  it('rejects an MP4 without a readable movie duration', () => {
    expect(() =>
      validateJobUploads([], {
        originalname: 'invalid.mp4',
        buffer: Buffer.from('not an MP4'),
      }),
    ).toThrow('The job video must be a valid MP4 with a readable duration.');
  });

  it('enforces photo count, file signatures, and per-photo size', () => {
    const photo = {
      originalname: 'photo.png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    };
    expect(validateJobUploads([photo])).toEqual([
      {
        type: JobMediaType.PHOTO,
        mimeType: 'image/png',
        extension: 'png',
        durationSeconds: null,
      },
    ]);
    expect(() =>
      validateJobUploads(Array.from({ length: 6 }, () => photo)),
    ).toThrow(BadRequestException);
    expect(() =>
      validateJobUploads([
        { ...photo, buffer: Buffer.alloc(JOB_MAX_PHOTO_BYTES + 1) },
      ]),
    ).toThrow('Each job photo must be 5 MiB or smaller.');
  });
});
