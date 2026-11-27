import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminDisputesController } from './admin-disputes.controller';
import { DisputesService } from './disputes.service';

describe('AdminDisputesController', () => {
  const disputes = {
    listForAdmin: jest.fn(),
    getForAdmin: jest.fn(),
    resolve: jest.fn(),
  };
  const controller = new AdminDisputesController(
    disputes as unknown as DisputesService,
  );
  const reflector = new Reflector();
  const admin = { id: 'admin-1', role: 'ADMIN' as const };

  beforeEach(() => jest.clearAllMocks());

  it('requires the JWT guard and the ADMIN role', () => {
    const guards =
      Reflect.getMetadata(GUARDS_METADATA, AdminDisputesController) ?? [];

    expect(guards).toEqual([AuthGuard('jwt'), RolesGuard]);
    expect(reflector.get(ROLES_KEY, AdminDisputesController)).toEqual(['ADMIN']);
  });

  it('forwards the state filter', async () => {
    disputes.listForAdmin.mockResolvedValue([]);

    await controller.list({ state: 'resolved' });

    expect(disputes.listForAdmin).toHaveBeenCalledWith('resolved');
  });

  it('defaults to open disputes when no state is given', async () => {
    disputes.listForAdmin.mockResolvedValue([]);

    await controller.list({});

    expect(disputes.listForAdmin).toHaveBeenCalledWith(undefined);
  });

  it('forwards the detail lookup', async () => {
    disputes.getForAdmin.mockResolvedValue({ job: { id: 'job-1' }, chat: null });

    await expect(controller.get('job-1')).resolves.toEqual({
      job: { id: 'job-1' },
      chat: null,
    });
    expect(disputes.getForAdmin).toHaveBeenCalledWith('job-1');
  });

  it('forwards the resolution with the admin as the reviewer', async () => {
    const dto = {
      outcome: 'PARTIAL' as const,
      amount: 25000,
      note: 'The extra work was never approved.',
    };
    disputes.resolve.mockResolvedValue({ id: 'job-1' });

    await controller.resolve(admin, 'job-1', dto);

    expect(disputes.resolve).toHaveBeenCalledWith('job-1', dto, 'admin-1');
  });
});
