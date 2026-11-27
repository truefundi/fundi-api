import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { VerificationStatus } from '@prisma/client';
import { ServiceExperienceDto } from '../../dto/service-experience.dto';
import { PagedQueryDto } from '../../../common/dto/paged-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** A service an approved technician applies to offer (catalog id or own name). */
export class AddTechnicianServiceDto extends ServiceExperienceDto {}

/** Change a pending service, or send a rejected one back for review. */
export class UpdateTechnicianServiceDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 60, example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  yearsOfExperience?: number;
}

export class ReviewTechnicianServiceDto {
  @ApiProperty({
    enum: [VerificationStatus.APPROVED, VerificationStatus.REJECTED],
  })
  @IsIn([VerificationStatus.APPROVED, VerificationStatus.REJECTED])
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Required when rejecting: shown to the technician.',
    example: 'The certificate is for electrical work, not plumbing.',
    maxLength: 1000,
  })
  @ValidateIf(
    (o: ReviewTechnicianServiceDto) => o.status === VerificationStatus.REJECTED,
  )
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give a reason when rejecting a service.' })
  @MaxLength(1000)
  reason?: string;
}

export class ListTechnicianServicesQueryDto extends PagedQueryDto {
  @ApiPropertyOptional({
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
  })
  @IsOptional()
  @IsIn(Object.values(VerificationStatus))
  status?: VerificationStatus;
}
