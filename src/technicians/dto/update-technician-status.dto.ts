import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

// Restricts administrator account-status changes to the declared states.
// SUSPENDED forces the technician offline and blocks login/sessions; ACTIVE
// restores normal access (approval and availability are enforced separately).
export class UpdateTechnicianStatusDto {
  @ApiProperty({
    example: UserStatus.SUSPENDED,
    description: 'The new account status for the technician.',
    enum: Object.values(UserStatus),
  })
  @IsEnum(UserStatus)
  status!: UserStatus;
}