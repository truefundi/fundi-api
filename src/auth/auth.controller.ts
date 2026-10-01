import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { PhoneDto } from './dto/phone.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import {
  ApiBadRequest,
  ApiConflict,
  ApiForbidden,
  ApiNotFound,
  ApiServiceUnavailable,
  ApiTokenRequired,
  ApiUnauthorized,
  ApiValidationFailed,
} from '../common/decorators/api-error-responses.decorator';

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService, private usersService: UsersService) {}

  // Creates a customer account and immediately starts phone verification.
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a customer and send a verification OTP',
    description:
      'Creates the account and sends the first OTP. The account is not usable until `/verify-otp` succeeds. `ADMIN` cannot be requested here.',
  })
  @ApiValidationFailed()
  @ApiConflict('An account with this phone number or email already exists.')
  @ApiServiceUnavailable('The OTP could not be stored, so the account was not started')
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  // Starts login only for an existing active account.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a login OTP to a registered phone number',
    description:
      'Only starts a login for an account that already exists and is active. The code expires in five minutes.',
  })
  @ApiValidationFailed()
  @ApiNotFound('No account was found for this phone number.')
  @ApiForbidden('This account is not active. Please contact the administrator.')
  @ApiServiceUnavailable()
  async login(@Body() body: PhoneDto) {
    return this.authService.requestLoginOtp(body.phoneNumber);
  }

  // Replaces the current OTP while enforcing the three-resend limit.
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend the pending login OTP up to three times',
    description:
      'Replaces the pending code and resets the attempt counter, but keeps the resend budget for the same pending OTP. Requires an OTP already in flight.',
  })
  @ApiValidationFailed()
  @ApiBadRequest('There is no pending OTP, or the three-resend limit has been reached.')
  @ApiNotFound('No account was found for this phone number.')
  @ApiForbidden('This account is not active. Please contact the administrator.')
  @ApiServiceUnavailable()
  async resendOtp(@Body() body: PhoneDto) {
    return this.authService.resendOtp(body.phoneNumber);
  }

  // Verifies the OTP, consumes it, and issues both JWTs.
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify an OTP and receive access and refresh tokens',
    description:
      'Consumes the pending code and issues a token pair. Five incorrect guesses lock verification for that account for fifteen minutes, during which even the correct code is refused.',
  })
  @ApiResponse({ status: 200, description: 'A token pair for the verified account', type: AuthTokensDto })
  @ApiValidationFailed()
  @ApiBadRequest('No OTP is pending. Request a new login OTP.')
  @ApiUnauthorized('The OTP is incorrect, or it has expired.')
  @ApiForbidden('The account is inactive, or too many incorrect attempts were made recently.')
  @ApiNotFound('No account was found for this phone number.')
  @ApiServiceUnavailable()
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(body.phoneNumber, body.otp);
  }

  // Returns the authenticated account's full record.
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiResponse({ status: 200, description: 'One full user record', type: UserResponseDto })
  @ApiTokenRequired()
  @ApiForbidden('The account is no longer active.')
  async me(@Req() request: { user: { userId: string } }) {
    return this.usersService.getById(request.user.userId);
  }

  // Exchanges a refresh token for a new pair without needing the expired access token.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new access and refresh pair',
    description:
      'Takes no access token, since the point is to renew after the old one expired. The supplied refresh token is single use and is revoked as the new pair is issued.',
  })
  @ApiResponse({ status: 200, description: 'A new token pair; the supplied refresh token is revoked', type: AuthTokensDto })
  @ApiValidationFailed()
  @ApiUnauthorized('The refresh token is invalid, expired, already used, or belongs to a deleted account.')
  @ApiForbidden('The account is no longer active.')
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  // Revokes the submitted refresh token for the authenticated account.
  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a refresh token',
    description:
      'Deletes the stored session, which ends the access token immediately as well as the refresh token. Submit the refresh token belonging to the account making the request.',
  })
  @ApiResponse({ status: 200, description: 'The session was revoked' })
  @ApiValidationFailed()
  @ApiUnauthorized('The access token is missing, expired, or revoked, or the refresh token does not belong to this account.')
  @ApiForbidden('The account is no longer active.')
  async logout(@Req() request: { user: { userId: string } }, @Body() body: LogoutDto) {
    return this.authService.logout(request.user.userId, body.refreshToken);
  }
}