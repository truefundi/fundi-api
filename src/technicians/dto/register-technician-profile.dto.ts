import { Type } from 'class-transformer';
import { IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { TechnicianBusinessType } from '@prisma/client';
import { CompanyDetailsDto } from '../../companies/dto/company.dto';
import { UpdateTechnicianProfileDto } from './update-technician-profile.dto';

export class RegisterTechnicianProfileDto extends UpdateTechnicianProfileDto {
  @IsOptional()
  @IsEnum(TechnicianBusinessType)
  businessType?: TechnicianBusinessType;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyDetailsDto)
  company?: CompanyDetailsDto;
}
