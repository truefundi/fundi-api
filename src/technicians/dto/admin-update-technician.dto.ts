import { IsEnum, IsOptional } from 'class-validator';
import { VerificationStatus } from '@prisma/client';
import { UpdateTechnicianProfileDto } from './update-technician-profile.dto';

// Adds administrator-only verification control to normal profile fields.
export class AdminUpdateTechnicianDto extends UpdateTechnicianProfileDto {
  @IsOptional()
  @IsEnum(VerificationStatus)
  verificationStatus?: VerificationStatus;
}
