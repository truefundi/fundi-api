import { UserRole, UserStatus, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AdminStatsService } from './admin-stats.service';

// Verifies the dashboard totals combine the three user counts and the pending
// technician-profile count, and that administrators are excluded.
describe('AdminStatsService', () => {
  const createService = (counts: {
    customers: number;
    technicians: number;
    pending: number;
    suspended: number;
  }) => {
    const userCount = jest
      .fn()
      .mockImplementation((args: { where: { role?: unknown } }) => {
        if (args.where.role === UserRole.CUSTOMER)
          return Promise.resolve(counts.customers);
        if (args.where.role === UserRole.TECHNICIAN)
          return Promise.resolve(counts.technicians);
        return Promise.resolve(counts.suspended);
      });
    const prisma = {
      user: { count: userCount },
      technicianProfile: {
        count: jest.fn().mockResolvedValue(counts.pending),
      },
    };
    return {
      service: new AdminStatsService(prisma as unknown as PrismaService),
      userCount,
      prisma,
    };
  };

  it('counts customers, technicians, pending verifications, and blocked accounts', async () => {
    const { service } = createService({
      customers: 730,
      technicians: 112,
      pending: 9,
      suspended: 4,
    });

    await expect(service.getStats()).resolves.toEqual({
      totalUsers: 842,
      totalCustomers: 730,
      totalTechnicians: 112,
      pendingVerifications: 9,
      suspendedAccounts: 4,
    });
  });

  it('counts customers and technicians by role and excludes administrators', async () => {
    const { service, userCount } = createService({
      customers: 1,
      technicians: 2,
      pending: 0,
      suspended: 0,
    });

    await service.getStats();

    expect(userCount).toHaveBeenCalledWith({
      where: { role: UserRole.CUSTOMER },
    });
    expect(userCount).toHaveBeenCalledWith({
      where: { role: UserRole.TECHNICIAN },
    });
    expect(userCount).toHaveBeenCalledWith({
      where: {
        role: { in: [UserRole.CUSTOMER, UserRole.TECHNICIAN] },
        status: UserStatus.SUSPENDED,
      },
    });
  });

  it('counts technician profiles awaiting verification', async () => {
    const { service, prisma } = createService({
      customers: 0,
      technicians: 0,
      pending: 3,
      suspended: 0,
    });

    await service.getStats();

    expect(prisma.technicianProfile.count).toHaveBeenCalledWith({
      where: { verificationStatus: VerificationStatus.PENDING },
    });
  });
});
