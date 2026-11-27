import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  applyDecorators,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import type { AuthMethod } from './jwt.strategy';

// Metadata key for routes that must never accept httpOnly cookie authentication.
const BEARER_ONLY_KEY = 'fundi:bearerOnly';

// Rejects a request that authenticated with the admin session cookie. Self-service
// account routes carry this because a cookie is attached automatically by the
// browser, which under SameSite=Lax is enough to make a mutating route reachable
// from another origin. Closing them to cookies leaves them reachable by mobile,
// which always sends a bearer token.
@Injectable()
export class BearerOnlyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(BEARER_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ headers?: { authorization?: string }; authMethod?: AuthMethod }>();
    // The header test is what makes this order-independent: a request with no
    // Authorization header cannot be bearer-authenticated, so it is rejected
    // whether or not the JWT guard has run yet. The tag is the precise test, and
    // applies when the JWT guard ran first.
    const hasBearerHeader = Boolean(request.headers?.authorization);
    if (!hasBearerHeader || request.authMethod === 'cookie') {
      throw new UnauthorizedException(
        'This route requires an access token in the Authorization header.',
      );
    }
    return true;
  }
}

// Marks a route as bearer-only. Applied as its own decorator so the metadata
// cannot be set without the guard, mirroring how @Auth() bundles both.
export const BearerOnly = () =>
  applyDecorators(
    SetMetadata(BEARER_ONLY_KEY, true),
    UseGuards(BearerOnlyGuard),
    ApiResponse({
      status: 401,
      description:
        'The request authenticated with a session cookie, which this route does not accept. Send `Authorization: Bearer <accessToken>`.',
      type: ErrorResponseDto,
    }),
  );