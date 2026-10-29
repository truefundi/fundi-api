import { ApiProperty } from '@nestjs/swagger';
import { CreateJobDto } from './create-job.dto';

/**
 * Swagger representation of POST /api/v1/jobs.
 * Multipart text fields are validated by the inherited CreateJobDto rules;
 * the file fields are consumed by the FileFieldsInterceptor.
 */
export class CreateJobMultipartDto extends CreateJobDto {
  @ApiProperty({
    type: 'array',
    required: false,
    maxItems: 5,
    items: { type: 'string', format: 'binary' },
    description: 'Optional job photos, maximum five files.',
  })
  declare photos?: unknown[];

  @ApiProperty({
    type: 'string',
    required: false,
    format: 'binary',
    description: 'Optional job video, maximum one file.',
  })
  declare video?: unknown;
}
