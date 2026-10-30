import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { UpdateTechnicianProfileDto } from './update-technician-profile.dto';
import {
  normalizeRwandaPhoneNumber,
  RWANDA_PHONE_NUMBER_PATTERN,
} from '../../common/validation/rwanda-phone-number';

// Validates the account identity an administrator supplies for a new technician.
export class CreateTechnicianUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  // Normalizes common display formatting before validating a phone number.
  @Transform(({ value }) =>
    normalizeRwandaPhoneNumber(value),
  )
  @IsString()
  @MinLength(13)
  @MaxLength(13)
  @Matches(RWANDA_PHONE_NUMBER_PATTERN)
  phoneNumber!: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;
}

// Accepts account identity and an optional profile in one administrator request.
export class CreateTechnicianDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateTechnicianUserDto)
  user!: CreateTechnicianUserDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateTechnicianProfileDto)
  profile?: UpdateTechnicianProfileDto;
}
