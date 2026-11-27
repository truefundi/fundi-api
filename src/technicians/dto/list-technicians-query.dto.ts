import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  TechnicianAvailability,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../common/dto/paged-query.dto';
import { MAX_SEARCH_LENGTH } from '../../common/dto/pagination.constants';
import {
  MAX_CATEGORY_LENGTH,
  MAX_YEARS_OF_EXPERIENCE,
} from './list-query.constants';

// Validates the optional query parameters on the technician list endpoints
// (admin list, admin search, and discovery). Unknown parameters are rejected
// by the global ValidationPipe (whitelist + forbidNonWhitelisted). Every
// filter combines with the others and is applied inside the database query.
// Paging (`page`, `limit`) is inherited from the shared PagedQueryDto.
export class ListTechniciansQueryDto extends PagedQueryDto {
  @ApiProperty({
    required: false,
    type: 'string',
    example: 'amina',
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Substring matched against full name, phone number, and email (name and email are case-insensitive).',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The search query parameter must not be empty.' })
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;

  @ApiProperty({
    required: false,
    type: 'string',
    example: 'Kigali',
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Substring matched against base address and public location label only, so people search and area search stay independent.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The location query parameter must not be empty.' })
  @MaxLength(MAX_SEARCH_LENGTH)
  location?: string;

  @ApiProperty({
    required: false,
    enum: Object.values(VerificationStatus),
    example: 'APPROVED',
    description: 'Only technicians with this verification status.',
  })
  @IsOptional()
  @IsEnum(VerificationStatus)
  verificationStatus?: VerificationStatus;

  @ApiProperty({
    required: false,
    enum: Object.values(TechnicianAvailability),
    example: 'ONLINE',
    description: 'Only technicians with this availability status.',
  })
  @IsOptional()
  @IsEnum(TechnicianAvailability)
  availabilityStatus?: TechnicianAvailability;

  @ApiProperty({
    required: false,
    enum: Object.values(UserStatus),
    example: 'ACTIVE',
    description: 'Only technicians whose linked user account has this status.',
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiProperty({
    required: false,
    type: 'string',
    format: 'uuid',
    example: 'e5a4f4d7-0b21-46d8-9a4b-98765d332100',
    description: 'Only technicians who list this service category ID.',
  })
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @ApiProperty({
    required: false,
    type: 'string',
    example: 'Plumbing',
    maxLength: MAX_CATEGORY_LENGTH,
    description:
      'Only technicians who list this service category, matched case-insensitively against the category name or slug.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'The category query parameter must not be empty.' })
  @MaxLength(MAX_CATEGORY_LENGTH)
  category?: string;

  @ApiProperty({
    required: false,
    type: 'integer',
    minimum: 0,
    maximum: MAX_YEARS_OF_EXPERIENCE,
    example: 3,
    description:
      'Only technicians with at least this many years of experience in one of their services — prefer senior technicians for a job.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_YEARS_OF_EXPERIENCE)
  minYearsOfExperience?: number;
}
