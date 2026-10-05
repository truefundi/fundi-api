import { Transform } from 'class-transformer';
import { DocumentType } from '@prisma/client';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

// Text fields sent alongside the uploaded file (multipart form fields).
export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type!: DocumentType;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;
}
