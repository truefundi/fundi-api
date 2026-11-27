import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  ValidateIf,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { VerificationStatus } from '@prisma/client';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

export class CompanyDetailsDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  location!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateAdminCompanyDto extends CompanyDetailsDto {
  @IsUUID('4')
  technicianId!: string;
}

export class UpdateCompanyDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateCompanyVerificationDto {
  @IsEnum(VerificationStatus)
  verificationStatus!: VerificationStatus;

  /** Why the company is rejected. Required with REJECTED; shown to the owner. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(
    (dto: UpdateCompanyVerificationDto) =>
      dto.verificationStatus === VerificationStatus.REJECTED ||
      dto.reason !== undefined,
  )
  @IsString()
  @IsNotEmpty({ message: 'Give a reason when rejecting a company.' })
  @MaxLength(1000)
  reason?: string;
}
