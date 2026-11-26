import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiExtension, ApiForbiddenResponse } from '@nestjs/swagger';
import { PermissionKey } from './permission-catalog';
import { PermissionsService } from './permissions.service';
import { isStaffRole } from './staff-roles';

export const PERMISSIONS_KEY = 'fundi:permissions';
// Used with @Auth; staff without explicit permission metadata are denied by default.
export const RequirePermissions = (...keys: PermissionKey[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, keys),
    ApiExtension('x-required-permissions', keys),
    ApiForbiddenResponse({
      description: 'The active staff session lacks the required permissions.',
    }),
  );

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context
      .switchToHttp()
      .getRequest<{
        user?: { userId?: string; id?: string; role?: string };
        authMethod?: string;
      }>();
    if (!isStaffRole(req.user?.role)) return true; // Customer/technician ownership checks still apply.
    if (req.authMethod !== 'cookie')
      throw new ForbiddenException(
        'Staff must use a dashboard cookie session.',
      );
    const keys = this.reflector.getAllAndOverride<PermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const userId = req.user?.userId ?? req.user?.id;
    if (!keys || !userId)
      throw new ForbiddenException('This route is not available to staff.');
    await this.permissions.require(userId, keys);
    return true;
  }
}
