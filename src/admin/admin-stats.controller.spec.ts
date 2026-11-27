import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';

// Keeps the whole stats controller behind the Request -> JWT guard ->
// RolesGuard(ADMIN) chain and confirms the handler forwards to the service.
describe('AdminStatsController', () => {
  const stats = { getStats: jest.fn() };
  const controller = new AdminStatsController(
    stats as unknown as AdminStatsService,
  );
  const reflector = new Reflector();

  beforeEach(() => jest.clearAllMocks());

  it('requires the JWT guard and the ADMIN role for the controller', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, AdminStatsController) ?? [];

    expect(guards).toEqual([AuthGuard('jwt'), RolesGuard]);
    expect(reflector.get(ROLES_KEY, AdminStatsController)).toEqual(['ADMIN']);
  });

  it('forwards the request to the stats service', async () => {
    const expected = {
      totalUsers: 1,
      totalCustomers: 1,
      totalTechnicians: 0,
      pendingVerifications: 0,
      suspendedAccounts: 0,
    };
    stats.getStats.mockResolvedValue(expected);

    await expect(controller.getStats()).resolves.toEqual(expected);
    expect(stats.getStats).toHaveBeenCalledTimes(1);
  });
});
