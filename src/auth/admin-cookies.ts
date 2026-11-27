import type { CookieOptions, Response } from 'express';
import { ConfigService } from '@nestjs/config';

// Admin session state lives in httpOnly cookies so no token is ever readable by
// injected script. The names are fixed because the JWT extractor in
// jwt.strategy.ts has to read the access cookie by name.

// Cookie holding the short-lived admin access JWT.
export const ADMIN_ACCESS_COOKIE = 'fundi_admin_access';
// Cookie holding the admin refresh JWT. Single use, rotated on every exchange.
export const ADMIN_REFRESH_COOKIE = 'fundi_admin_refresh';
// Cookie holding the opaque id of a pending two-factor challenge. It grants
// nothing on its own — it only lets /2fa/verify find the challenge to check a
// code against — and it is confined to the 2FA path so it rides along with
// nothing else.
export const ADMIN_2FA_CHALLENGE_COOKIE = 'fundi_admin_2fa_challenge';

// Path the challenge cookie is scoped to. It has to be a prefix of every route
// that needs it, and it has to match exactly when the cookie is cleared.
export const ADMIN_2FA_COOKIE_PATH = '/api/v1/auth/admin/2fa';

// The session cookies must reach every admin route, not just the ones that set them.
// Left unset, a browser scopes a cookie to the directory of the request that created
// it, which here would hide them from /api/v1/users and silently break the dashboard.
export const ADMIN_SESSION_COOKIE_PATH = '/';

interface AdminCookieSettings {
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  domain?: string;
}

// Reads the configured cookie flags. `domain` is omitted when unset so the
// browser keeps the cookie host-only, which is the tighter default.
export function adminCookieBase(configService: ConfigService): CookieOptions {
  const cookie = configService.get<AdminCookieSettings>('adminAuth.cookie', {});
  return {
    httpOnly: true,
    sameSite: cookie.sameSite ?? 'lax',
    secure: cookie.secure ?? false,
    ...(cookie.domain ? { domain: cookie.domain } : {}),
  };
}

// Clears a cookie. Express already expires it, but the options must repeat the
// path and flags it was set with or the browser keeps the original.
export function clearAdminCookie(response: Response, name: string, options: CookieOptions) {
  response.clearCookie(name, options);
}