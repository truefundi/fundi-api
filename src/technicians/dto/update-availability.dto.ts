import { IsEnum } from 'class-validator';
import { TechnicianAvailability } from '@prisma/client';

// Validates an online/offline availability change.
export class UpdateAvailabilityDto {
  @IsEnum(TechnicianAvailability)
  availabilityStatus!: TechnicianAvailability;
}
