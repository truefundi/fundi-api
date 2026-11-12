import { applyDecorators, createParamDecorator, ExecutionContext, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiCookieAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';

export interface AuthUser {
  id: string;
  role: UserRole;
}

/** JWT auth + role check in one decorator: @Auth(UserRole.ADMIN). Works on classes and methods. */
export const Auth = (...roles: UserRole[]) => {
  const apiAuth = [];
  if (roles.some((role) => role !== UserRole.ADMIN)) {
    apiAuth.push(ApiBearerAuth('accessToken'));
  }
  if (roles.includes(UserRole.ADMIN)) {
    apiAuth.push(ApiCookieAuth('adminAccessToken'));
  }

  return applyDecorators(
    UseGuards(AuthGuard('jwt'), RolesGuard),
    Roles(...roles),
    ...apiAuth,
  );
};

/** Normalises whatever your JwtStrategy puts on req.user into { id, role }. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const u = ctx.switchToHttp().getRequest().user ?? {};
  return { id: u.id ?? u.userId ?? u.sub, role: u.role };
});
