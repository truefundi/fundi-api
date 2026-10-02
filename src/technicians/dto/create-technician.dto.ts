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

// Validates the account identity an administrator supplies for a new technician.
export class CreateTechnicianUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  // Normalizes common display formatting before validating a phone number.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value,
  )
  @IsString()
  @MinLength(7)
  @MaxLength(20)
  @Matches(/^\+?[0-9]+$/)
  phoneNumber!: string;

  @IsOptional()
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
