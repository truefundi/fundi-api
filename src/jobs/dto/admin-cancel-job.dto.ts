import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Admin cancellation: the reason is kept on the job and in the audit log. */
export class AdminCancelJobDto {
  @ApiProperty({
    required: false,
    maxLength: 500,
    description: 'Why the admin cancelled the job. Shown on the job record.',
    example: 'Duplicate request created by mistake.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason?: string;
}
