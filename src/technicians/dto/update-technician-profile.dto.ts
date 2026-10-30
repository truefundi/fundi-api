import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PaymentMethod,
  TechnicianAvailability,
  TechnicianGender,
} from '@prisma/client';
import { ServiceExperienceDto } from './service-experience.dto';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

export class UpdateTechnicianProfileDto {
  @IsOptional()
  @IsEnum(TechnicianGender)
  gender?: TechnicianGender;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replace(/[\s-]/g, '').toUpperCase()
      : value,
  )
  @IsString()
  @MinLength(5)
  @MaxLength(32)
  @Matches(/^[A-Z0-9]+$/)
  nationalIdNumber?: string;

  @IsOptional()
  @Transform(({ value }) => (value === null ? undefined : value))
  @IsString()
  @MaxLength(255)
  baseAddress?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @MaxLength(120)
  publicLocationLabel?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === '' ? null : Number(value),
  )
  @IsNumber()
  @Min(-90)
  @Max(90)
  baseLatitude?: number | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === '' ? null : Number(value),
  )
  @IsNumber()
  @Min(-180)
  @Max(180)
  baseLongitude?: number | null;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  paymentNumber?: string;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : value))
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ServiceExperienceDto)
  serviceExperiences?: ServiceExperienceDto[];

  @IsOptional()
  @IsEnum(TechnicianAvailability)
  availabilityStatus?: TechnicianAvailability;
}
