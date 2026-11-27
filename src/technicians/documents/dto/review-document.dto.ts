import { Transform } from 'class-transformer';
import { DocumentStatus } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const REVIEW_STATUSES = [
  DocumentStatus.REVIEWING,
  DocumentStatus.ACCEPTED,
  DocumentStatus.DENIED,
];

// An administrator's decision on one submitted document.
export class ReviewDocumentDto {
  @IsIn(REVIEW_STATUSES)
  status!: DocumentStatus;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}
