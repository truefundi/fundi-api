import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CertificateType, DocumentType } from '@prisma/client';


export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type!: DocumentType;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title!: string;

  // ── Certificate-only fields (type === CERTIFICATE) ─────────────────────

  // Required when the document is a certificate.
  @ValidateIf((o) => o.type === DocumentType.CERTIFICATE)
  @IsEnum(CertificateType)
  certificateType?: CertificateType;

  // A real service category. Marked required unless `customCategoryName` is
  // present. Note that `@IsOptional()` combined with `@ValidateIf` means:
  // "only validate this when ValidateIf passes, and only then is it required".
  @ValidateIf(
    (o) =>
      o.type === DocumentType.CERTIFICATE &&
      !o.customCategoryName &&
      o.categoryId !== undefined,
  )
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  // A free-text service name for a service that isn't in the catalogue.
  @ValidateIf(
    (o) =>
      o.type === DocumentType.CERTIFICATE &&
      !o.categoryId &&
      o.customCategoryName !== undefined,
  )
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  customCategoryName?: string;
}