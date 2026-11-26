import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { PermissionsService } from './permissions.service';
import { PermissionsGuard } from './permissions.guard';
import { STAFF_ROLES } from './staff-roles';
import { PERMISSION_KEYS } from './permission-catalog';

describe('Live staff permissions', () => {
  function setup(role = 'ADMIN', keys: string[] = []) {
    const user = {
      id: 'staff',
      role,
      status: 'ACTIVE',
      staffPermissions: keys.map((key) => ({ permission: { key } })),
    };
    const prisma = { user: { findUnique: jest.fn(async () => user) } };
    return {
      user,
      prisma,
      service: new PermissionsService(prisma as unknown as PrismaService),
    };
  }

  it.each(STAFF_ROLES.filter((r) => r !== 'SUPER_ADMIN'))(
    '%s grants nothing by label and cannot receive staff.manage',
    async (role) => {
      const { service } = setup(role, ['staff.manage', 'unknown']);
      expect((await service.access('staff')).permissions).toEqual([]);
      await expect(
        service.require('staff', ['users.view']),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.requireSuperAdmin('staff')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    },
  );

  it('reads grants on every request, including revocations and deactivation', async () => {
    const { user, service } = setup('SUPPORT', ['payments.view']);
    await expect(
      service.require('staff', ['payments.view']),
    ).resolves.toBeDefined();
    user.staffPermissions = [];
    await expect(
      service.require('staff', ['payments.view']),
    ).rejects.toBeInstanceOf(ForbiddenException);
    user.role = 'SUPER_ADMIN';
    expect((await service.access('staff')).permissions).toEqual(
      PERMISSION_KEYS,
    );
    user.status = 'SUSPENDED';
    await expect(service.access('staff')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails closed for staff routes without explicit permission metadata', async () => {
    const { service } = setup('SUPER_ADMIN');
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const guard = new PermissionsGuard(
      reflector as unknown as Reflector,
      service,
    );
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'staff', role: 'SUPER_ADMIN' },
          authMethod: 'cookie',
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    reflector.getAllAndOverride.mockReturnValue([]);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
