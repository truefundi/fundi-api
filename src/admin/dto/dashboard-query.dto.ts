import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  BookingPaymentStatus,
  ChatMessageType,
  JobRequestType,
  JobStatus,
  TechnicianAvailability,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { PagedQueryDto } from '../../common/dto/paged-query.dto';

export enum DashboardPeriod {
  TODAY = 'today',
  LAST_7_DAYS = 'last7days',
  CURRENT_MONTH = 'currentMonth',
  SELECTED_MONTH = 'month',
  CURRENT_YEAR = 'currentYear',
  SELECTED_YEAR = 'year',
  CUSTOM = 'custom',
}

export enum DashboardInterval {
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class DashboardQueryDto {
  @ApiPropertyOptional({
    enum: DashboardPeriod,
    default: DashboardPeriod.CURRENT_MONTH,
  })
  @IsOptional()
  @IsEnum(DashboardPeriod)
  period?: DashboardPeriod;

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  compare?: boolean;

  @ApiPropertyOptional({
    example: '2025-01',
    pattern: '^\\d{4}-(0[1-9]|1[0-2])$',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;

  @ApiPropertyOptional({ minimum: 2000, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(9999)
  year?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ example: 'Africa/Kigali', default: 'UTC' })
  @IsOptional()
  @IsString()
  timezone?: string;

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

  @ApiPropertyOptional({ enum: JobRequestType })
  @IsOptional()
  @IsEnum(JobRequestType)
  requestType?: JobRequestType;

  @ApiPropertyOptional({ enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  jobStatus?: JobStatus;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  userRole?: UserRole;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  userStatus?: UserStatus;

  @ApiPropertyOptional({ enum: VerificationStatus })
  @IsOptional()
  @IsEnum(VerificationStatus)
  technicianVerificationStatus?: VerificationStatus;

  @ApiPropertyOptional({ enum: TechnicianAvailability })
  @IsOptional()
  @IsEnum(TechnicianAvailability)
  technicianAvailability?: TechnicianAvailability;

  @ApiPropertyOptional({ enum: BookingPaymentStatus })
  @IsOptional()
  @IsEnum(BookingPaymentStatus)
  paymentStatus?: BookingPaymentStatus;

  @ApiPropertyOptional({ enum: ChatMessageType })
  @IsOptional()
  @IsEnum(ChatMessageType)
  chatMessageType?: ChatMessageType;
}

export class DashboardTrendsQueryDto extends DashboardQueryDto {
  @ApiPropertyOptional({ enum: DashboardInterval })
  @IsOptional()
  @IsEnum(DashboardInterval)
  interval?: DashboardInterval;
}

export class DashboardActivityQueryDto extends DashboardQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class TopTechniciansQueryDto extends DashboardQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
