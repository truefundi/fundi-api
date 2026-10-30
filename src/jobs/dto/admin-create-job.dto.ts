import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateJobDto } from './create-job.dto';

/**
 * Admin variant of the customer job request: the same service, description,
 * location and price fields plus the customer account the admin is acting for.
 */
export class AdminCreateJobDto extends CreateJobDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Active customer account to create the request for. The admin places the request on their behalf.',
    example: 'e5a4f4d7-0b21-46d8-9a4b-98765d332100',
  })
  @IsUUID('4')
  customerId!: string;
}
