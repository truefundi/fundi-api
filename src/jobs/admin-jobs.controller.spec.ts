import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminJobsController } from './admin-jobs.controller';
import { JobsService } from './jobs.service';

// Keeps the admin jobs controller behind the Request -> JWT guard ->
// RolesGuard(ADMIN) chain and confirms the summary handler forwards to the service.
describe('AdminJobsController', () => {
  const jobs = {
    listForAdmin: jest.fn(),
    getForAdmin: jest.fn(),
    summaryForAdmin: jest.fn(),
  };
  const controller = new AdminJobsController(jobs as unknown as JobsService);
  const reflector = new Reflector();

  beforeEach(() => jest.clearAllMocks());

  it('requires the JWT guard and the ADMIN role for the controller', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, AdminJobsController) ?? [];

    expect(guards).toEqual([AuthGuard('jwt'), RolesGuard]);
    expect(reflector.get(ROLES_KEY, AdminJobsController)).toEqual(['ADMIN']);
  });

  it('forwards the summary request to the jobs service', async () => {
    const expected = { active: 3, completed: 5, openDisputes: null };
    jobs.summaryForAdmin.mockResolvedValue(expected);

    await expect(controller.summary()).resolves.toEqual(expected);
    expect(jobs.summaryForAdmin).toHaveBeenCalledTimes(1);
  });
});
