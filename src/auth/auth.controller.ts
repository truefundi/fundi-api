import {
  Controller,
  Post,
  Get,
  Body,
  Delete,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Headers,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
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
import { PasswordLoginDto } from './dto/password-login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { PinRegisterDto } from './dto/pin-register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasskeyAuthenticationDto } from './dto/passkey-authentication.dto';
import { PasskeyRegistrationDto } from './dto/passkey-registration.dto';
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
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  // Customer registration is immediate; technician registration requires OTP verification.
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a customer or start technician phone verification',
    description:
      'Customer accounts are created without registration OTP verification. Technician accounts receive an OTP and must verify it before completing a profile. `ADMIN` cannot be requested here.',
  })
  @ApiValidationFailed()
  @ApiConflict('An account with this phone number or email already exists.')
  @ApiServiceUnavailable(
    'The OTP could not be stored for technician registration.',
  )
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post('register/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register a customer account with a phone number and PIN',
    description:
      'Creates a customer account with a 4–6 digit PIN. A full name is required. The PIN is stored as a bcrypt hash, separately from any account password.',
  })
  @ApiValidationFailed()
  @ApiConflict('An account with this phone number already exists.')
  async registerWithPin(@Body() body: PinRegisterDto) {
    return this.authService.registerWithPin(body);
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
  @ApiBadRequest(
    'There is no pending OTP, or the three-resend limit has been reached.',
  )
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
  @ApiResponse({
    status: 200,
    description: 'A token pair for the verified account',
    type: AuthTokensDto,
  })
  @ApiValidationFailed()
  @ApiBadRequest('No OTP is pending. Request a new login OTP.')
  @ApiUnauthorized('The OTP is incorrect, or it has expired.')
  @ApiForbidden(
    'The account is inactive, or too many incorrect attempts were made recently.',
  )
  @ApiNotFound('No account was found for this phone number.')
  @ApiServiceUnavailable()
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.verifyOtp(body.phoneNumber, body.otp, deviceId);
  }

  @Post('login/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with a phone number and optional account password',
    description:
      'For customer and technician accounts with a password configured. OTP login remains available as a fallback. Administrators must use the admin portal.',
  })
  @ApiValidationFailed()
  @ApiUnauthorized('The phone number or password is incorrect.')
  @ApiForbidden('The account is inactive, unverified, or temporarily locked.')
  @ApiServiceUnavailable()
  async loginWithPassword(
    @Body() body: PasswordLoginDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.loginWithPassword(
      body.phoneNumber,
      body.password,
      deviceId,
    );
  }

  @Post('login/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with a phone number and PIN',
    description:
      'For customer and verified technician accounts with a PIN configured. OTP and password sign-in remain available.',
  })
  @ApiValidationFailed()
  @ApiUnauthorized('The phone number or PIN is incorrect.')
  @ApiForbidden('The account is inactive, unverified, or temporarily locked.')
  @ApiServiceUnavailable()
  async loginWithPin(
    @Body() body: PinLoginDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.loginWithPin(body.phoneNumber, body.pin, deviceId);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set or reset an account password after SMS OTP verification',
    description:
      'First request an OTP using `POST /api/v1/auth/login`; then submit that OTP with the new password. No phone-number-only password reset is allowed.',
  })
  @ApiValidationFailed()
  @ApiBadRequest('No OTP is pending.')
  @ApiUnauthorized('The phone number or OTP is incorrect or expired.')
  @ApiForbidden('The account is inactive.')
  @ApiServiceUnavailable()
  async resetPassword(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(
      body.phoneNumber,
      body.otp,
      body.newPassword,
    );
  }

  @Post('passkeys/registration/options')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate options to register a passkey on the current account',
    description:
      'Requires a customer or verified technician bearer session. The response is passed to the device passkey API.',
  })
  @ApiTokenRequired()
  @ApiForbidden('The account is inactive or is an administrator.')
  @ApiServiceUnavailable()
  async passkeyRegistrationOptions(
    @Req() request: { user: { userId: string } },
  ) {
    return this.authService.generatePasskeyRegistrationOptions(
      request.user.userId,
    );
  }

  @Post('passkeys/registration/verify')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify and save a newly registered passkey',
    description:
      'Submit the credential response produced from the registration options. Only the public key and authenticator counter are stored.',
  })
  @ApiValidationFailed()
  @ApiTokenRequired()
  @ApiUnauthorized('The passkey response is invalid.')
  @ApiConflict('This passkey is already registered.')
  @ApiServiceUnavailable()
  async verifyPasskeyRegistration(
    @Req() request: { user: { userId: string } },
    @Body() body: PasskeyRegistrationDto,
  ) {
    return this.authService.verifyPasskeyRegistration(
      request.user.userId,
      body.response,
    );
  }

  @Get('passkeys')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @ApiOperation({
    summary: 'List passkeys registered to the current account',
    description:
      'Returns only passkey identifiers, creation times, and transport hints.',
  })
  @ApiTokenRequired()
  async listPasskeys(@Req() request: { user: { userId: string } }) {
    return this.authService.listPasskeys(request.user.userId);
  }

  @Delete('passkeys/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a passkey from the current account' })
  @ApiTokenRequired()
  @ApiNotFound('No passkey with that ID belongs to this account.')
  async removePasskey(
    @Req() request: { user: { userId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.authService.removePasskey(request.user.userId, id);
  }

  @Post('passkeys/authentication/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a passkey sign-in challenge',
    description:
      'Send the account phone number. The returned challenge is short-lived and can be used once.',
  })
  @ApiValidationFailed()
  @ApiUnauthorized('No passkey is registered or available for this account.')
  @ApiForbidden('The account is inactive or an unverified technician.')
  @ApiServiceUnavailable()
  async passkeyAuthenticationOptions(@Body() body: PhoneDto) {
    return this.authService.generatePasskeyAuthenticationOptions(
      body.phoneNumber,
    );
  }

  @Post('passkeys/authentication/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify a passkey assertion and sign in',
    description:
      'Submit the same phone number and the credential response produced from the passkey authentication options.',
  })
  @ApiValidationFailed()
  @ApiBadRequest('No passkey sign-in is pending or the challenge has expired.')
  @ApiUnauthorized('The passkey response is invalid.')
  @ApiForbidden('The account is inactive or an unverified technician.')
  @ApiServiceUnavailable()
  async verifyPasskeyAuthentication(
    @Body() body: PasskeyAuthenticationDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.authService.verifyPasskeyAuthentication(
      body.phoneNumber,
      body.response,
      deviceId,
    );
  }

  // Returns the authenticated account's full record.
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'One full user record',
    type: UserResponseDto,
  })
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
  @ApiResponse({
    status: 200,
    description: 'A new token pair; the supplied refresh token is revoked',
    type: AuthTokensDto,
  })
  @ApiValidationFailed()
  @ApiUnauthorized(
    'The refresh token is invalid, expired, already used, or belongs to a deleted account.',
  )
  @ApiForbidden('The account is no longer active.')
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  // Revokes the submitted refresh token for the authenticated account.
  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke a refresh token',
    description:
      'Deletes the stored session, which ends the access token immediately as well as the refresh token. Submit the refresh token belonging to the account making the request.',
  })
  @ApiResponse({ status: 200, description: 'The session was revoked' })
  @ApiValidationFailed()
  @ApiUnauthorized(
    'The access token is missing, expired, or revoked, or the refresh token does not belong to this account.',
  )
  @ApiForbidden('The account is no longer active.')
  async logout(
    @Req() request: { user: { userId: string } },
    @Body() body: LogoutDto,
  ) {
    return this.authService.logout(request.user.userId, body.refreshToken);
  }
}
