import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEmail, IsEnum, IsInt, IsNumber, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PaymentMethod, TechnicianAvailability, TechnicianGender,
} from '@prisma/client';
import { ServiceExperienceDto } from './service-experience.dto';

export class UpdateTechnicianProfileDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value)
  @IsString() @MinLength(7) @MaxLength(20) @Matches(/^\+?[0-9]+$/)
  phoneNumber?: string;

  @IsOptional() @IsEmail() @MaxLength(254)
  email?: string | null;

  @IsOptional() @IsEnum(TechnicianGender)
  gender?: TechnicianGender;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/[\s-]/g, '').toUpperCase()
    : value)
  @IsString() @MinLength(4) @MaxLength(64) @Matches(/^[A-Z0-9]+$/)
  nationalIdNumber?: string;

  @IsOptional() @IsString() @MaxLength(255)
  baseAddress?: string;

  @IsOptional() @IsString() @MaxLength(120)
  publicLocationLabel?: string | null;

  @IsOptional()
  @Transform(({ value }) => value === null || value === undefined ? value : Number(value))
  @IsNumber() @Min(-90) @Max(90)
  baseLatitude?: number;

  @IsOptional()
  @Transform(({ value }) => value === null || value === undefined ? value : Number(value))
  @IsNumber() @Min(-180) @Max(180)
  baseLongitude?: number;

  @IsOptional() @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.replace(/\s/g, '') : value)
  @IsString() @MinLength(6) @MaxLength(24) @Matches(/^\+?[0-9]+$/)
  paymentNumber?: string;

  @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : value)
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true })
  @Type(() => ServiceExperienceDto)
  serviceExperiences?: ServiceExperienceDto[];

  @IsOptional() @IsEnum(TechnicianAvailability)
  availabilityStatus?: TechnicianAvailability;
}