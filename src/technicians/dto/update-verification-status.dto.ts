import { IsEnum } from 'class-validator';
import { VerificationStatus } from '@prisma/client';

// Restricts administrator verification changes to the declared workflow states.
export class UpdateVerificationStatusDto {
  @IsEnum(VerificationStatus)
  verificationStatus!: VerificationStatus;
}
