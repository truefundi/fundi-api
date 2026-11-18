import { IsEnum, IsOptional } from 'class-validator';
import { VerificationStatus } from '@prisma/client';

export class ListCompaniesDto {
  @IsOptional()
  @IsEnum(VerificationStatus)
  verificationStatus?: VerificationStatus;
}
