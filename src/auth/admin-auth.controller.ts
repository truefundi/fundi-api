import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { VerifyAdminTwoFactorDto } from './dto/admin-2fa.dto';
import {
  AdminSessionDto,
  AdminTwoFactorEnrollDto,
  AdminTwoFactorRequiredDto,
  AdminUserDto,
} from './dto/admin-auth-response.dto';
import {
  ADMIN_2FA_CHALLENGE_COOKIE,
  ADMIN_2FA_COOKIE_PATH,
  ADMIN_ACCESS_COOKIE,
  ADMIN_REFRESH_COOKIE,
  ADMIN_SESSION_COOKIE_PATH,
  adminCookieBase,
  clearAdminCookie,
} from './admin-cookies';
import { Auth, CurrentUser, type AuthUser } from '../common/decorators/auth.decorator';
import {
  ApiBadRequest,
  ApiForbidden,
  ApiServiceUnavailable,
  ApiTokenRequired,
  ApiTooManyRequests,
  ApiUnauthorized,
  ApiValidationFailed,
} from '../common/decorators/api-error-responses.decorator';

// The JWT guard leaves the identity on the request under `user`; express's own
// Request type does not declare it.
type AuthenticatedRequest = Request & { user?: { userId?: string } };

interface SessionResult {
  user: AdminUserDto;
  expiresInSeconds: number;
  tokens: { accessToken: string; refreshToken: string };
}

@ApiTags('admin-auth')
@Controller('api/v1/auth/admin')
export class AdminAuthController {
  constructor(
    private adminAuthService: AdminAuthService,
    private configService: ConfigService,
  ) {}

  // Step one of admin sign-in: password, then a second factor from an authenticator
  // app. The answer has two shapes, because the first sign-in on an account also has
  // to set the factor up.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiExtraModels(AdminTwoFactorEnrollDto, AdminTwoFactorRequiredDto)
  @ApiOperation({
    summary: 'Start an admin sign-in with email and password',
    description:
      'On success no token is issued. A two-factor challenge cookie is set and the code from the authenticator app must be submitted to `/2fa/verify` before any protected route will answer.\n\n' +
      'Returns `enrollmentRequired: true` with an `otpauthUri` and `secret` on the very first sign-in of an account, which is what the dashboard renders as a QR code. Once an authenticator is enrolled it returns `enrollmentRequired: false` and only asks for the code.\n\n' +
      'The secret is returned so a client that cannot scan can type it in. It is sent with `Cache-Control: no-store` and is stored only after a first code is accepted, so a sign-in that is abandoned leaves nothing behind.\n\n' +
      'Every credential failure answers `401` with the same message, so this endpoint cannot be used to discover which addresses belong to an administrator.',
  })
  @ApiResponse({
    status: 200,
    description: 'Password accepted, waiting on the authenticator',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AdminTwoFactorEnrollDto) },
        { $ref: getSchemaPath(AdminTwoFactorRequiredDto) },
      ],
    },
  })
  @ApiValidationFailed()
  @ApiUnauthorized(
    'The email or password is incorrect, or the account is not an active administrator.',
  )
  @ApiTooManyRequests('Too many failed sign-in attempts for this address.')
  @ApiServiceUnavailable('The rate-limit store or the secret store is unavailable.')
  async login(@Body() body: AdminLoginDto, @Res({ passthrough: true }) response: Response) {
    const { challengeId, ...result } = await this.adminAuthService.login(body);
    // The body carries the shared secret on a first sign-in, so it must not be cached
    // by the browser or by any proxy in between.
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(ADMIN_2FA_CHALLENGE_COOKIE, challengeId, this.challengeCookieOptions());
    return result;
  }

  // Step two: checks the code and issues the session cookies.
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('adminTwoFactorChallenge')
  @ApiOperation({
    summary: 'Submit the authenticator code and receive an admin session',
    description:
      'The only step that issues tokens. The access and refresh tokens are set as httpOnly cookies and are never included in the response body, so nothing on the page can read them.\n\n' +
      'On a first sign-in the same request confirms the enrolment, which is what commits the secret to the account. Submitting a correct code consumes it: replaying it answers `400`, so one code is worth at most one session.',
  })
  @ApiResponse({
    status: 200,
    description: 'An authenticated admin session',
    type: AdminSessionDto,
  })
  @ApiBadRequest('There is no pending verification, or the challenge was already used.')
  @ApiUnauthorized('The code is incorrect, or the sign-in window has closed.')
  @ApiTooManyRequests(
    'Too many incorrect codes were submitted for this account. Wait a few minutes.',
  )
  @ApiServiceUnavailable()
  @ApiForbidden('The account is no longer an active administrator.')
  async verifyTwoFactor(
    @Req() request: AuthenticatedRequest,
    @Body() body: VerifyAdminTwoFactorDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adminAuthService.verifyTwoFactor(
      this.challengeId(request),
      body.code,
    );
    response.setHeader('Cache-Control', 'no-store');
    this.clearChallengeCookie(response);
    this.setSessionCookies(response, result.tokens);
    return this.sessionBody(result);
  }

  // Rotates the session from the refresh cookie alone.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('adminRefreshToken')
  @ApiOperation({
    summary: 'Exchange the refresh cookie for a fresh admin session',
    description:
      'Takes no body and no access token, because it is normally called after the short-lived access token has expired. The presented token is single use and is revoked as the new pair is issued.',
  })
  @ApiResponse({ status: 200, description: 'A renewed admin session', type: AdminSessionDto })
  @ApiBadRequest('There is no session cookie to refresh.')
  @ApiUnauthorized(
    'The session is invalid, expired, or belongs to an account that is no longer an active administrator.',
  )
  @ApiServiceUnavailable()
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[ADMIN_REFRESH_COOKIE];
    if (!refreshToken) {
      throw new BadRequestException('There is no session cookie to refresh.');
    }
    const result = await this.adminAuthService.refresh(refreshToken);
    this.setSessionCookies(response, result.tokens);
    return this.sessionBody(result);
  }

  // Ends the session and clears every cookie. Takes no access token on purpose, so
  // signing out still works once the access cookie has expired.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('adminRefreshToken')
  @ApiOperation({
    summary: 'Sign out and clear the admin cookies',
    description:
      'Revokes the stored session when the refresh cookie is present, and always clears all three cookies. Succeeds even when the refresh token is unknown, so the dashboard can never be left holding a session it cannot drop.',
  })
  @ApiResponse({ status: 200, description: 'The session was ended and the cookies cleared' })
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adminAuthService.logout(
      request.cookies?.[ADMIN_REFRESH_COOKIE] ?? '',
    );
    this.clearSessionCookies(response);
    return result;
  }

  // Returns the identity behind an authenticated admin session. Answers 401 until
  // /2fa/verify has completed, which is what keeps the dashboard shut to a
  // half-finished sign-in.
  @Get('me')
  @Auth(UserRole.ADMIN)
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({ summary: 'Get the authenticated administrator' })
  @ApiResponse({
    status: 200,
    description: 'The administrator behind the session',
    type: AdminUserDto,
  })
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  async me(@CurrentUser() user: AuthUser) {
    return this.adminAuthService.getAdminUser(user.id);
  }

  // Writes the access and refresh cookies. The refresh cookie's lifetime comes from
  // the same setting as the stored session row, so the two cannot drift apart.
  private setSessionCookies(
    response: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const base = { ...adminCookieBase(this.configService), path: ADMIN_SESSION_COOKIE_PATH };
    response.cookie(ADMIN_ACCESS_COOKIE, tokens.accessToken, {
      ...base,
      maxAge: this.adminAuthService.accessTokenSeconds() * 1000,
    });
    response.cookie(ADMIN_REFRESH_COOKIE, tokens.refreshToken, {
      ...base,
      maxAge: this.adminAuthService.refreshTokenSeconds() * 1000,
    });
  }

  // Repeats the flags and path each cookie was set with, or the browser keeps it.
  private clearSessionCookies(response: Response) {
    const base = { ...adminCookieBase(this.configService), path: ADMIN_SESSION_COOKIE_PATH };
    clearAdminCookie(response, ADMIN_ACCESS_COOKIE, base);
    clearAdminCookie(response, ADMIN_REFRESH_COOKIE, base);
    this.clearChallengeCookie(response);
  }

  private clearChallengeCookie(response: Response) {
    clearAdminCookie(response, ADMIN_2FA_CHALLENGE_COOKIE, {
      ...adminCookieBase(this.configService),
      path: ADMIN_2FA_COOKIE_PATH,
    });
  }

  // Aged from the challenge lifetime so the cookie disappears at roughly the same
  // moment the code does, rather than outliving it.
  private challengeCookieOptions() {
    return {
      ...adminCookieBase(this.configService),
      path: ADMIN_2FA_COOKIE_PATH,
      maxAge: this.adminAuthService.twoFactorChallengeSeconds() * 1000,
    };
  }

  // Strips the tokens, which must not reach the response body.
  private sessionBody({ user, expiresInSeconds }: SessionResult) {
    return { user, expiresInSeconds };
  }

  private challengeId(request: AuthenticatedRequest): string {
    return request.cookies?.[ADMIN_2FA_CHALLENGE_COOKIE] ?? '';
  }
}