import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

// Restricts administrator status changes to active or inactive accounts.
export class UpdateStatusDto {
  @ApiProperty({
    example: 'INACTIVE',
    description: 'The new account status.',
    enum: Object.values(UserStatus),
  })
  @IsEnum(UserStatus)
  status!: UserStatus;
}