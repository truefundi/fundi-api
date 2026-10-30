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

class RegisterTechnicianUserDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @Transform(({ value }) => normalizeRwandaPhoneNumber(value))
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

export class RegisterTechnicianDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => RegisterTechnicianUserDto)
  user!: RegisterTechnicianUserDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => UpdateTechnicianProfileDto)
  profile!: UpdateTechnicianProfileDto;
}
