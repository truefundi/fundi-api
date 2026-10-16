import { ApiProperty } from '@nestjs/swagger';

// Platform-wide account counts shown on the admin dashboard (GET /admin/stats).
export class AdminStatsResponseDto {
  @ApiProperty({
    example: 842,
    description:
      'Customers and technicians together. Administrators are excluded.',
  })
  totalUsers!: number;

  @ApiProperty({
    example: 730,
    description: 'Accounts with the CUSTOMER role.',
  })
  totalCustomers!: number;

  @ApiProperty({
    example: 112,
    description: 'Accounts with the TECHNICIAN role.',
  })
  totalTechnicians!: number;

  @ApiProperty({
    example: 9,
    description: 'Technician profiles awaiting verification (PENDING).',
  })
  pendingVerifications!: number;

  @ApiProperty({
    example: 4,
    description:
      'Customer and technician accounts that are blocked from logging in ' +
      '(status SUSPENDED).',
  })
  suspendedAccounts!: number;
}
