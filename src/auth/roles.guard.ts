import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import type { AuthMethod } from './jwt.strategy';

// Rejects authenticated requests whose role is not allowed by route metadata.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  // Compares the role loaded from the current database-backed JWT identity.
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;
    const request = context.switchToHttp().getRequest<{
      user?: { role?: string };
      authMethod?: AuthMethod;
    }>();
    if (!request.user?.role || !requiredRoles.includes(request.user.role)) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }
    // Administrator authority only ever comes from the httpOnly session cookie
    // issued after password + authenticator verification. A bearer token carrying
    // the ADMIN role is refused outright so a leaked phone-OTP token, or one minted
    // before that flow was closed, cannot reach the dashboard.
    if (request.user.role === 'ADMIN' && request.authMethod !== 'cookie') {
      throw new ForbiddenException('Administrator sessions must use the admin portal.');
    }
    return true;
  }
}
