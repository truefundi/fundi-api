import { ApiProperty } from '@nestjs/swagger';
import { DisputeOutcome } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** The customer or assigned technician's reason for escalating a job. */
export class OpenDisputeDto {
  @ApiProperty({
    minLength: 10,
    maxLength: 2000,
    description: 'Why the job is being disputed.',
    example: 'The work was marked complete, but the leak is still present.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}

/** What the admin decided and how much the customer must settle. */
export class ResolveDisputeDto {
  @ApiProperty({
    enum: DisputeOutcome,
    description:
      'Who the decision favours: CUSTOMER, TECHNICIAN, or PARTIAL for "partly each".',
    example: DisputeOutcome.PARTIAL,
  })
  @IsEnum(DisputeOutcome)
  outcome!: DisputeOutcome;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2_000_000_000,
    description:
      'Repair amount the customer must settle after the decision, in the job currency (RWF). Excludes the visit fee.',
    example: 25000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  amount!: number;

  @ApiProperty({
    minLength: 2,
    maxLength: 2000,
    description: 'The admin’s reasoning. Shown to both parties on the resolved dispute.',
    example:
      'The chat shows RWF 25,000 agreed for the repair; the extra RWF 5,000 was never approved.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  note!: string;
}

/** `open` lists disputes without a resolution; `resolved` lists decided ones. */
export class ListDisputesQueryDto {
  @ApiProperty({
    required: false,
    enum: ['open', 'resolved'],
    default: 'open',
    description: 'Filter by dispute state. Defaults to open.',
  })
  @IsOptional()
  @IsIn(['open', 'resolved'])
  state?: 'open' | 'resolved';
}
