import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { TechnicianAvailability, VerificationStatus } from '@prisma/client';

// Validates admin filters for a multi-field technician search.
export class SearchTechniciansDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  query?: string;
  
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  @Matches(/^[A-Z0-9]+$/)
  nationalIdNumber?: string;

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsEnum(VerificationStatus)
  verificationStatus?: VerificationStatus;

  @IsOptional()
  @IsEnum(TechnicianAvailability)
  availabilityStatus?: TechnicianAvailability;
}
