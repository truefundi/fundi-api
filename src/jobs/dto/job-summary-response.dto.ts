import { ApiProperty } from '@nestjs/swagger';

// Job counts for the admin dashboard (GET /admin/jobs/summary).
export class JobSummaryResponseDto {
  @ApiProperty({
    example: 23,
    description: 'Jobs still in flight: status OPEN or ASSIGNED.',
  })
  active!: number;

  @ApiProperty({ example: 417, description: 'Jobs with status COMPLETED.' })
  completed!: number;

  @ApiProperty({
    example: 2,
    description:
      'Disputes that have no resolution yet. A resolved dispute no longer counts.',
  })
  openDisputes!: number;
}
