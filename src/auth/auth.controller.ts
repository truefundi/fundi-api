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

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(private authService: AuthService, private usersService: UsersService) {}

  // Creates a customer account and immediately starts phone verification.
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a customer and send a verification OTP' })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  // Starts login only for an existing active account.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a login OTP to a registered phone number' })
  async login(@Body() body: PhoneDto) {
    return this.authService.requestLoginOtp(body.phoneNumber);
  }

  // Replaces the current OTP while enforcing the three-resend limit.
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the pending login OTP up to three times' })
  async resendOtp(@Body() body: PhoneDto) {
    return this.authService.resendOtp(body.phoneNumber);
  }

  // Verifies the OTP, consumes it, and issues both JWTs.
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an OTP and receive access and refresh tokens' })
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(body.phoneNumber, body.otp);
  }

  // Returns the authenticated account's full record.
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current authenticated user' })
  @ApiResponse({ status: 200, description: 'One full user record' })
  @ApiResponse({ status: 401, description: 'The access token is missing, expired, or revoked' })
  @ApiResponse({ status: 403, description: 'The account is no longer active' })
  async me(@Req() request: { user: { userId: string } }) {
    return this.usersService.getById(request.user.userId);
  }

  // Exchanges a refresh token for a new pair without needing the expired access token.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for a new access and refresh pair' })
  @ApiResponse({ status: 200, description: 'A new token pair; the supplied refresh token is revoked' })
  @ApiResponse({ status: 401, description: 'The refresh token is invalid, expired, or already used' })
  @ApiResponse({ status: 403, description: 'The account is no longer active' })
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  // Revokes the submitted refresh token for the authenticated account.
  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Req() request: { user: { userId: string } }, @Body() body: LogoutDto) {
    return this.authService.logout(request.user.userId, body.refreshToken);
  }
}
