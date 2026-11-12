import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Admin reassignment: hand the job to a different technician. */
export class AdminReassignJobDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Technician profile ID of the technician who should take the job.',
    example: '5f0f0f8e-4c4c-4b0e-9f4e-6f7c8d9a0b1c',
  })
  @IsUUID('4')
  technicianId!: string;
}
