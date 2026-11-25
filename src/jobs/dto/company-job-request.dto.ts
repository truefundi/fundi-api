import { IsUUID } from 'class-validator';

export class CompanyJobRequestDto {
  @IsUUID('4')
  companyId!: string;
}
