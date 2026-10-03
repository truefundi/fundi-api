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
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { VerifyAdminTwoFactorDto } from './dto/admin-2fa.dto';
import {
  AdminSessionDto,
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

  // Step one of admin sign-in: password, then a second factor over SMS.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start an admin sign-in with email and password',
    description:
      'On success no token is issued. A two-factor challenge cookie is set and a six-digit code is sent by SMS, which must be submitted to `/2fa/verify` before any protected route will answer. Every credential failure answers `401` with the same message, so this endpoint cannot be used to discover which addresses belong to an administrator.',
  })
  @ApiResponse({
    status: 200,
    description: 'Password accepted, code sent',
    type: AdminTwoFactorRequiredDto,
  })
  @ApiValidationFailed()
  @ApiUnauthorized(
    'The email or password is incorrect, or the account is not an active administrator.',
  )
  @ApiServiceUnavailable(
    'The verification code could not be sent, or the rate-limit store is unavailable.',
  )
  async login(@Body() body: AdminLoginDto, @Res({ passthrough: true }) response: Response) {
    const { challengeId, ...result } = await this.adminAuthService.login(body);
    response.cookie(ADMIN_2FA_CHALLENGE_COOKIE, challengeId, this.challengeCookieOptions());
    return result;
  }

  // Replaces the pending code while keeping the resend budget for that challenge.
  @Post('2fa/resend')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('adminTwoFactorChallenge')
  @ApiOperation({
    summary: 'Resend the pending two-factor code',
    description:
      'Requires the challenge cookie from `/login`. Can be called at most three times per challenge. Resending does not clear the failed-attempt count.',
  })
  @ApiResponse({
    status: 200,
    description: 'A replacement code was sent',
    type: AdminTwoFactorRequiredDto,
  })
  @ApiBadRequest(
    'There is no pending verification, or the three-resend limit has been reached.',
  )
  @ApiServiceUnavailable('The code could not be sent, or the rate-limit store is unavailable.')
  async resendTwoFactor(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const challengeId = this.challengeId(request);
    const result = await this.adminAuthService.resendTwoFactor(challengeId);
    // Re-issues the cookie so it ages alongside the extended challenge.
    response.cookie(ADMIN_2FA_CHALLENGE_COOKIE, challengeId, this.challengeCookieOptions());
    return result;
  }

  // Step two: checks the code and issues the session cookies.
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('adminTwoFactorChallenge')
  @ApiOperation({
    summary: 'Submit the two-factor code and receive an admin session',
    description:
      'The only step that issues tokens. The access and refresh tokens are set as httpOnly cookies and are never included in the response body, so nothing on the page can read them. Submitting a correct code consumes it.',
  })
  @ApiResponse({
    status: 200,
    description: 'An authenticated admin session',
    type: AdminSessionDto,
  })
  @ApiBadRequest('There is no pending verification.')
  @ApiUnauthorized('The code is incorrect or has expired.')
  @ApiServiceUnavailable()
  @ApiForbidden(
    'Too many incorrect codes were submitted, or the account is no longer an active administrator.',
  )
  async verifyTwoFactor(
    @Req() request: AuthenticatedRequest,
    @Body() body: VerifyAdminTwoFactorDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adminAuthService.verifyTwoFactor(
      this.challengeId(request),
      body.code,
    );
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