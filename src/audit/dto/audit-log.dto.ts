import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by entity type (for example Job, User, Dispute).',
    example: 'Job',
  })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional({
    description: 'Filter by the affected entity id.',
    example: '2f7a0f6e-4b3d-4f5a-9b7d-1d2f3c4b5a6e',
  })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({
    description: 'Filter by audit action.',
    example: 'JOB_CREATED',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description: 'Filter by the actor who performed the action.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Return logs created at or after this ISO-8601 timestamp.',
    example: '2026-11-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Return logs created at or before this ISO-8601 timestamp.',
    example: '2026-11-30T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of records to return.',
    default: 50,
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;

  @ApiPropertyOptional({
    description: 'Number of records to skip before collecting results.',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

export class AuditLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Job' })
  entityType!: string;

  @ApiProperty({ example: '2f7a0f6e-4b3d-4f5a-9b7d-1d2f3c4b5a6e' })
  entityId!: string;

  @ApiProperty({ example: 'JOB_CREATED' })
  action!: string;

  @ApiPropertyOptional({ nullable: true, example: 'OPEN' })
  fromStatus!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'ASSIGNED' })
  toStatus!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  actorId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: 'object', additionalProperties: true })
  metadata!: unknown;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class ListAuditLogsResponseDto {
  @ApiProperty({ type: [AuditLogResponseDto] })
  items!: AuditLogResponseDto[];

  @ApiProperty({ example: 120 })
  total!: number;

  @ApiProperty({ example: 50 })
  limit!: number;

  @ApiProperty({ example: 0 })
  offset!: number;
}
