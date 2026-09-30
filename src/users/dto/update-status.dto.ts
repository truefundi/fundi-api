import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';

// Restricts administrator status changes to active or inactive accounts.
export class UpdateStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}