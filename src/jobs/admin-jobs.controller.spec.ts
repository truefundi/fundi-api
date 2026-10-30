import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminJobsController } from './admin-jobs.controller';
import { JobsService } from './jobs.service';

// Keeps the admin jobs controller behind the Request -> JWT guard ->
// RolesGuard(ADMIN) chain and confirms each handler forwards to the service.
describe('AdminJobsController', () => {
  const jobs = {
    listForAdmin: jest.fn(),
    getForAdmin: jest.fn(),
    summaryForAdmin: jest.fn(),
    createForAdmin: jest.fn(),
    adminUpdate: jest.fn(),
    adminCancel: jest.fn(),
    adminReassign: jest.fn(),
    permanentlyDelete: jest.fn(),
  };
  const controller = new AdminJobsController(jobs as unknown as JobsService);
  const reflector = new Reflector();
  const admin = { id: 'admin-1', role: 'ADMIN' as const };

  beforeEach(() => jest.clearAllMocks());

  it('requires the JWT guard and the ADMIN role for the controller', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, AdminJobsController) ?? [];

    expect(guards).toEqual([AuthGuard('jwt'), RolesGuard]);
    expect(reflector.get(ROLES_KEY, AdminJobsController)).toEqual(['ADMIN']);
  });

  it('forwards the summary request to the jobs service', async () => {
    const expected = { active: 3, completed: 5, openDisputes: 2 };
    jobs.summaryForAdmin.mockResolvedValue(expected);

    await expect(controller.summary()).resolves.toEqual(expected);
    expect(jobs.summaryForAdmin).toHaveBeenCalledTimes(1);
  });

  it('creates a job for the admin user', async () => {
    const dto = {
      customerId: 'customer-1',
      description: 'The kitchen sink has been leaking since yesterday.',
      locationAddress: 'Kimironko',
      latitude: -1.94,
      longitude: 30.06,
      offeredAmount: 20000,
      otherServiceName: 'Plumbing',
    } as never;
    jobs.createForAdmin.mockResolvedValue({ id: 'job-1' });

    await controller.create(admin, dto);

    expect(jobs.createForAdmin).toHaveBeenCalledWith(dto, 'admin-1');
  });

  it('forwards an edit with the admin as the actor', async () => {
    const dto = { priority: 'HIGH' } as never;
    jobs.adminUpdate.mockResolvedValue({ id: 'job-1' });

    await controller.update(admin, 'job-1', dto);

    expect(jobs.adminUpdate).toHaveBeenCalledWith('job-1', dto, 'admin-1');
  });

  it('forwards a cancellation with the reason', async () => {
    jobs.adminCancel.mockResolvedValue({ id: 'job-1' });

    await controller.cancel(admin, 'job-1', { reason: 'Duplicate request' });

    expect(jobs.adminCancel).toHaveBeenCalledWith(
      'job-1',
      'Duplicate request',
      'admin-1',
    );
  });

  it('forwards a reassignment with the chosen technician', async () => {
    jobs.adminReassign.mockResolvedValue({ id: 'job-1' });

    await controller.reassign(admin, 'job-1', { technicianId: 'tech-1' });

    expect(jobs.adminReassign).toHaveBeenCalledWith(
      'job-1',
      'tech-1',
      'admin-1',
    );
  });

  it('permanently deletes a completed or cancelled job as an admin action', async () => {
    jobs.permanentlyDelete.mockResolvedValue({
      message: 'Job permanently deleted.',
    });

    await expect(controller.delete(admin, 'job-1')).resolves.toEqual({
      message: 'Job permanently deleted.',
    });
    expect(jobs.permanentlyDelete).toHaveBeenCalledWith('job-1', 'admin-1');
  });
});
