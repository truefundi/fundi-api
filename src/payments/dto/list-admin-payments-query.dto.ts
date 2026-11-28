import { ApiPropertyOptional } from '@nestjs/swagger';
import { BookingPaymentStatus, JobRequestType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AdminListQueryDto } from '../../common/dto/admin-list-query.dto';

export enum AdminPaymentSort {
  PAID_AT = 'paidAt',
  CREATED_AT = 'createdAt',
  AMOUNT = 'amount',
  VALID_UNTIL = 'validUntil',
}

export class ListAdminPaymentsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({
    enum: BookingPaymentStatus,
    description:
      'Effective status: overdue VALID/RESUMED payments count as EXPIRED without writing during reads.',
  })
  @IsOptional()
  @IsEnum(BookingPaymentStatus)
  status?: BookingPaymentStatus;

  @ApiPropertyOptional({ enum: JobRequestType })
  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  serviceCategoryId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Inclusive paidAt lower bound.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Exclusive paidAt upper bound; must be after from.',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    enum: AdminPaymentSort,
    default: AdminPaymentSort.PAID_AT,
  })
  @IsOptional()
  @IsEnum(AdminPaymentSort)
  sortBy?: AdminPaymentSort;
}
