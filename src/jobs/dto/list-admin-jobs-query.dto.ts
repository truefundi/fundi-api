import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobPriority, JobRequestType, JobStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AdminListQueryDto } from '../../common/dto/admin-list-query.dto';

export enum AdminJobGroup {
  MATCHING = 'matching',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  DISPUTED = 'disputed',
}

export enum AdminJobSort {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
  PRIORITY = 'priority',
  OFFERED_AMOUNT = 'offeredAmount',
}

export class ListAdminJobsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiPropertyOptional({
    enum: AdminJobGroup,
    description:
      'matching=OPEN; in_progress=ASSIGNED/PAUSED; cancelled=CANCELLED/FAILED; disputed=unresolved dispute. Combines with status.',
  })
  @IsOptional()
  @IsEnum(AdminJobGroup)
  group?: AdminJobGroup;

  @ApiPropertyOptional({ enum: JobPriority })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @ApiPropertyOptional({ enum: JobRequestType })
  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  serviceCategoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  customerId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  technicianId?: string;

  @ApiPropertyOptional({ enum: AdminJobSort, default: AdminJobSort.CREATED_AT })
  @IsOptional()
  @IsEnum(AdminJobSort)
  sortBy?: AdminJobSort;
}
