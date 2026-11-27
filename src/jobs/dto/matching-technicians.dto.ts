import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class MatchingTechniciansDto {
  @IsOptional()
  @IsUUID('4')
  serviceCategoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  otherServiceName?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude!: number;

  /**
   * Also list approved technicians who are offline. They can still be sent a
   * request (POST /jobs/mine/:jobId/offline-requests) and have two hours to reply.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeOffline?: boolean;
}

export class ProposeTechnicianDto {
  @IsUUID('4')
  technicianId!: string;
}
