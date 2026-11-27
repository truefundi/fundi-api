import { IsIn } from 'class-validator';
import { UserRole } from '@prisma/client';

export class SwitchRoleDto {
  @IsIn([UserRole.CUSTOMER, UserRole.TECHNICIAN])
  role!: UserRole;
}
