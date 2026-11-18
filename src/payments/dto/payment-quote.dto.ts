import { IsEnum, IsUUID } from 'class-validator';
import { JobRequestType } from '@prisma/client';
import { IsOptional } from 'class-validator';

export class PaymentQuoteDto {
  @IsUUID('4')
  serviceCategoryId!: string;

  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;
}
