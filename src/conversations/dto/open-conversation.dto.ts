import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// Opens (or fetches, idempotently) the price-negotiation conversation for a job.
export class OpenConversationDto {
  @ApiProperty({
    example: 'a497ee8b-205a-4f5c-9e8a-6352f2207bd4',
    description: 'The job whose chosen technician this conversation is with.',
  })
  @IsUUID('4')
  jobId!: string;
}
