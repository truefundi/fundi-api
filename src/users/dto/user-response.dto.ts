import { ApiProperty } from '@nestjs/swagger';
import { UserRole, UserStatus } from '@prisma/client';

// Full user record as returned by GET /auth/me and every users route.
export class UserResponseDto {
  @ApiProperty({ example: '9c1f4d2e-7a3b-4c8e-9f10-2b5d6e8a1c34' })
  id!: string;

  @ApiProperty({ example: 'prince@example.com', nullable: true })
  email!: string | null;

  @ApiProperty({ example: '+250788123456' })
  phoneNumber!: string;

  @ApiProperty({ example: 'Prince Example' })
  fullName!: string;

  @ApiProperty({ enum: Object.values(UserRole), example: 'CUSTOMER' })
  role!: UserRole;

  @ApiProperty({ enum: Object.values(UserStatus), example: 'ACTIVE' })
  status!: UserStatus;

  @ApiProperty({ example: '2026-09-30T10:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-09-30T10:00:00.000Z' })
  updatedAt!: Date;
}