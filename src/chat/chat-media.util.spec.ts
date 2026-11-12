import { BadRequestException } from '@nestjs/common';
import { ChatMessageType } from '@prisma/client';
import { validateChatUpload } from './chat-media.util';

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
  return Buffer.concat([fileType, box('moov', box('mvhd', movieHeader))]);
}

function ebmlElement(id: number[], content: Buffer): Buffer {
  if (content.length >= 127) throw new Error('Test element is too large.');
  return Buffer.concat([
    Buffer.from(id),
    Buffer.from([0x80 | content.length]),
    content,
  ]);
}

function webmWithDuration(seconds: number): Buffer {
  const scale = ebmlElement(
    [0x2a, 0xd7, 0xb1],
    Buffer.from([0x0f, 0x42, 0x40]),
  );
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(seconds * 1000);
  const info = ebmlElement(
    [0x15, 0x49, 0xa9, 0x66],
    Buffer.concat([scale, ebmlElement([0x44, 0x89], duration)]),
  );
  const header = ebmlElement([0x1a, 0x45, 0xdf, 0xa3], Buffer.alloc(0));
  return Buffer.concat([header, ebmlElement([0x18, 0x53, 0x80, 0x67], info)]);
}

describe('chat media validation', () => {
  it('detects an image signature and checks the declared MIME and extension', () => {
    const upload = {
      originalname: 'picture.png',
      mimetype: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    };

    expect(validateChatUpload(upload, ChatMessageType.IMAGE)).toMatchObject({
      mimeType: 'image/png',
      extension: 'png',
      sizeBytes: 8,
    });
    expect(() =>
      validateChatUpload(
        { ...upload, originalname: 'picture.pdf' },
        ChatMessageType.IMAGE,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateChatUpload(
        { ...upload, mimetype: 'image/jpeg' },
        ChatMessageType.IMAGE,
      ),
    ).toThrow('does not match the detected image/png');
  });

  it('accepts a Word document only when the file has a DOCX signature', () => {
    const upload = {
      originalname: 'work.docx',
      mimetype:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('word/document.xml'),
      ]),
    };

    expect(validateChatUpload(upload, ChatMessageType.FILE)).toMatchObject({
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    });
    expect(() =>
      validateChatUpload(
        { ...upload, buffer: Buffer.from('not a document') },
        ChatMessageType.FILE,
      ),
    ).toThrow('valid PDF, Word DOC, or Word DOCX');
  });

  it('measures MP4 and WebM durations and rejects long videos', () => {
    expect(
      validateChatUpload(
        {
          originalname: 'clip.mp4',
          mimetype: 'video/mp4',
          buffer: mp4WithDuration(30),
        },
        ChatMessageType.VIDEO,
      ).durationSeconds,
    ).toBe(30);
    expect(
      validateChatUpload(
        {
          originalname: 'clip.webm',
          mimetype: 'video/webm',
          buffer: webmWithDuration(45),
        },
        ChatMessageType.VIDEO,
      ).durationSeconds,
    ).toBe(45);
    expect(() =>
      validateChatUpload(
        {
          originalname: 'long.webm',
          mimetype: 'video/webm',
          buffer: webmWithDuration(61),
        },
        ChatMessageType.VIDEO,
      ),
    ).toThrow('no longer than 60 seconds');
  });
});
