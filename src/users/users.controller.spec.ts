import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { BearerOnlyGuard } from '../auth/bearer-only.guard';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// Verifies every admin route keeps the Request -> JWT guard -> RolesGuard(ADMIN)
// chain, and that thin controller handlers forward to the service unchanged.
describe('UsersController', () => {
  const usersService = {
    findAll: jest.fn(),
    search: jest.fn(),
    getByEmail: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    updateAccount: jest.fn(),
    deleteAccount: jest.fn(),
  };
  const controller = new UsersController(usersService as unknown as UsersService);
  const reflector = new Reflector();

  // Keeps cumulative mock call records from leaking between tests.
  beforeEach(() => jest.clearAllMocks());

  const adminRoutes = [
    'create',
    'findAll',
    'search',
    'findByEmail',
    'findById',
    'update',
    'updateStatus',
    'delete',
  ] as const;

  // Reads the guard list a route advertises to the Nest runtime.
  const guardsOf = (handler: (...args: never[]) => unknown): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];

  describe('admin authorization', () => {
    it.each(adminRoutes)('%s requires the JWT guard and the ADMIN role', (name) => {
      const handler = UsersController.prototype[name];

      const guards = guardsOf(handler as (...args: never[]) => unknown);
      expect(guards).toHaveLength(2);
      expect(guards[0]).toBe(AuthGuard('jwt'));
      expect(guards[1]).toBe(RolesGuard);
      expect(reflector.get(ROLES_KEY, handler)).toEqual(['ADMIN']);
    });

    // CUSTOMER and TECHNICIAN callers are rejected by RolesGuard with a 403
    // before the controller runs (see roles.guard.spec.ts for the behaviour).
    it('forbids non-admin roles at the guard layer', () => {
      const guard = new RolesGuard({
        getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
      } as unknown as Reflector);
      const contextWithRole = (role: string) =>
        ({
          switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
          getHandler: () => undefined,
          getClass: () => UsersController,
        }) as unknown as Parameters<typeof guard.canActivate>[0];

      expect(guard.canActivate(contextWithRole('ADMIN'))).toBe(true);
      expect(() => guard.canActivate(contextWithRole('CUSTOMER'))).toThrow(
        'You do not have permission to perform this action.',
      );
      expect(() => guard.canActivate(contextWithRole('TECHNICIAN'))).toThrow(
        'You do not have permission to perform this action.',
      );
    });
  });

  describe('account-owner routes', () => {
    // The /me routes stay usable by any signed-in user (no role gate), but they
    // reject cookie auth, so BearerOnlyGuard joins the JWT guard.
    it.each(['updateAccount', 'deleteAccount'] as const)(
      '%s requires the JWT guard and rejects cookie auth',
      (name) => {
        const handler = UsersController.prototype[name];

        expect(guardsOf(handler as (...args: never[]) => unknown)).toEqual([
          AuthGuard('jwt'),
          BearerOnlyGuard,
        ]);
        expect(reflector.get(ROLES_KEY, handler)).toBeUndefined();
      },
    );
  });

  describe('request forwarding', () => {
    it('forwards the listing query to the service untouched', async () => {
      const query = {
        page: 2,
        limit: 10,
        role: 'TECHNICIAN' as UserRole,
        status: 'ACTIVE' as UserStatus,
        search: 'john',
      };
      const expected = { data: [], pagination: { page: 2, limit: 10, total: 0, totalPages: 0 } };
      usersService.findAll.mockResolvedValue(expected);

      await expect(controller.findAll(query)).resolves.toEqual(expected);
      expect(usersService.findAll).toHaveBeenCalledWith(query);
    });

    it('forwards the status change to the service', async () => {
      const id = '0a1b2c3d-0000-4000-8000-000000000001';
      usersService.updateStatus.mockResolvedValue({ id, status: 'INACTIVE' });

      await controller.updateStatus(id, { status: 'INACTIVE' });

      expect(usersService.updateStatus).toHaveBeenCalledWith(id, 'INACTIVE');
    });

    it('forwards the user lookup to the service', async () => {
      const id = '0a1b2c3d-0000-4000-8000-000000000001';
      usersService.getById.mockResolvedValue({ id });

      await controller.findById(id);

      expect(usersService.getById).toHaveBeenCalledWith(id);
    });
  });
});
