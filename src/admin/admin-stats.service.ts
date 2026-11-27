import { Injectable } from '@nestjs/common';
import { UserRole, UserStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class AdminStatsService {
  constructor(private readonly prisma: PrismaService) {}

  // Counts the platform's customers, technicians, pending verifications, and
  // blocked accounts in one round trip. Administrators are excluded from every
  // figure so the dashboard totals only the two public account types.
  async getStats() {
    const [
      totalCustomers,
      totalTechnicians,
      pendingVerifications,
      suspendedAccounts,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.CUSTOMER } }),
      this.prisma.user.count({ where: { role: UserRole.TECHNICIAN } }),
      this.prisma.technicianProfile.count({
        where: { verificationStatus: VerificationStatus.PENDING },
      }),
      this.prisma.user.count({
        where: {
          role: { in: [UserRole.CUSTOMER, UserRole.TECHNICIAN] },
          // Suspended accounts are blocked from logging in and using sessions;
          // they are the dashboard's "suspended" figure. INACTIVE is a separate
          // opt-out state and is not counted here.
          status: UserStatus.SUSPENDED,
        },
      }),
    ]);

    return {
      totalUsers: totalCustomers + totalTechnicians,
      totalCustomers,
      totalTechnicians,
      pendingVerifications,
      suspendedAccounts,
    };
  }
}
