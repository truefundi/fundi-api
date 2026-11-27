import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { VerificationStatus } from '@prisma/client';

// Restricts administrator verification changes to the declared workflow states.
export class UpdateVerificationStatusDto {
  @IsEnum(VerificationStatus)
  verificationStatus!: VerificationStatus;

  @ApiPropertyOptional({
    description:
      'Why the application is rejected. Required with REJECTED; shown to the technician.',
    maxLength: 1000,
    example:
      'Your ID photo is unreadable. Please apply again with a clear photo.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @ValidateIf(
    (dto: UpdateVerificationStatusDto) =>
      dto.verificationStatus === VerificationStatus.REJECTED ||
      dto.reason !== undefined,
  )
  @IsString()
  @IsNotEmpty({ message: 'Give a reason when rejecting an application.' })
  @MaxLength(1000)
  reason?: string;
}
