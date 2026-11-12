import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { JobPipelineStage } from '../job-pipeline';

// One dashboard pipeline card. Untracked stages keep `count` null so the
// client can show them as unavailable instead of a fabricated zero.
export class JobPipelineStageDto {
  @ApiProperty({
    enum: JobPipelineStage,
    example: JobPipelineStage.REQUEST,
    description: 'Stable stage identifier used by the drill-down endpoint.',
  })
  key!: JobPipelineStage;

  @ApiProperty({ example: 'Request', description: 'Dashboard label.' })
  label!: string;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 12,
    description:
      'Jobs at this stage. Null when the backend cannot prove the stage.',
  })
  count!: number | null;

  @ApiProperty({
    example: true,
    description:
      'Whether stored job state is enough to count this stage. Untracked stages return `count: null`.',
  })
  tracked!: boolean;

  @ApiProperty({
    example: 'Open jobs still waiting for dispatch to start.',
    description: 'How the count is derived from stored job state.',
  })
  description!: string;
}

export class JobPipelineResponseDto {
  @ApiProperty({
    type: JobPipelineStageDto,
    isArray: true,
    description: 'The ten stages in lifecycle order.',
  })
  stages!: JobPipelineStageDto[];

  @ApiProperty({
    example: '2026-11-09T09:00:00.000Z',
    description: 'When the counts were read.',
  })
  generatedAt!: string;
}

export class JobPipelineStagePageDto {
  @ApiProperty({
    type: JobPipelineStageDto,
    description: 'The requested stage, with `count` equal to `total`.',
  })
  stage!: JobPipelineStageDto;

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Admin job objects at this stage, newest first. Empty for an untracked stage.',
  })
  data!: object[];

  @ApiProperty({
    type: PaginationMetaDto,
    description: 'Pagination metadata for the stage query.',
  })
  pagination!: PaginationMetaDto;
}
