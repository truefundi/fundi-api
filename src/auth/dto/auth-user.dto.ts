import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

// The reduced user object embedded in the token responses.
export class AuthUserDto {
  @ApiProperty({ example: '9c1f4d2e-7a3b-4c8e-9f10-2b5d6e8a1c34' })
  id!: string;

  @ApiProperty({ example: 'Prince Example' })
  fullName!: string;

  @ApiProperty({ example: '+250788123456' })
  phoneNumber!: string;

  @ApiProperty({ enum: Object.values(UserRole), example: 'CUSTOMER' })
  role!: UserRole;
}