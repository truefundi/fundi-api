import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private smsService: SmsService,
  ) {}

  // Creates a customer or technician account, defaulting to customer, then starts OTP verification.
  async register(input: RegisterDto) {
    try {
      const user = await this.prisma.user.create({
        data: {
          fullName: input.fullName.trim(),
          phoneNumber: input.phoneNumber,
          email: input.email || null,
          role: input.role === 'TECHNICIAN' ? UserRole.TECHNICIAN : UserRole.CUSTOMER,
        },
        select: { id: true, fullName: true, phoneNumber: true, role: true },
      });
      await this.issueOtp(user.id, user.phoneNumber, 0);
      return { message: 'OTP generated. Verify it to complete registration.', user };
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException('An account with this phone number or email already exists.');
      }
      throw error;
    }
  }

  // Checks account existence and active status before creating a login OTP.
  async requestLoginOtp(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) throw new NotFoundException('No account was found for this phone number.');
    this.ensureActive(user.status);
    await this.issueOtp(user.id, user.phoneNumber, 0);
    return { message: 'OTP generated. It expires in one minute.' };
  }

  // Issues a replacement OTP while retaining the pending request's resend count.
  async resendOtp(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) throw new NotFoundException('No account was found for this phone number.');
    this.ensureActive(user.status);
    const pending = await this.prisma.loginOtp.findUnique({ where: { userId: user.id } });
    if (!pending) throw new BadRequestException('There is no pending OTP. Request a login OTP first.');
    if (pending.resendCount >= 3) {
      throw new BadRequestException('The maximum of three OTP resends has been reached.');
    }
    await this.issueOtp(user.id, user.phoneNumber, pending.resendCount + 1, pending.verificationTries);
    return { message: `OTP resent. ${3 - pending.resendCount - 1} resend(s) remain.` };
  }

  // Verifies a time-limited OTP and creates persisted refresh-token state.
  async verifyOtp(phoneNumber: string, otp: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) throw new NotFoundException('No account was found for this phone number.');
    this.ensureActive(user.status);
    const pending = await this.prisma.loginOtp.findUnique({ where: { userId: user.id } });
    if (!pending) throw new BadRequestException('No OTP is pending. Request a new login OTP.');
    if (pending.expiresAt.getTime() <= Date.now()) {
      await this.prisma.loginOtp.delete({ where: { userId: user.id } });
      throw new UnauthorizedException('The OTP has expired. Request a new login OTP.');
    }
    if (pending.verificationTries >= 5) {
      throw new ForbiddenException('Too many incorrect OTP attempts. Request a new login OTP.');
    }
    if (!this.matchesOtp(otp, pending.codeHash)) {
      await this.prisma.loginOtp.update({
        where: { userId: user.id },
        data: { verificationTries: { increment: 1 } },
      });
      throw new UnauthorizedException('The OTP is incorrect.');
    }
    await this.prisma.loginOtp.delete({ where: { userId: user.id } });
    const { sessionId, ...tokens } = await this.generateTokens(user.id, user.phoneNumber, user.role);
    const refreshHash = this.hash(tokens.refreshToken);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { token: refreshHash, sessionId, userId: user.id, expiresAt: refreshExpiresAt },
    });
    return {
      user: { id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, role: user.role },
      ...tokens,
    };
  }

  // Deletes the matching stored refresh-token hash to end the session.
  async logout(userId: string, refreshToken: string) {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { userId, token: this.hash(refreshToken) },
    });
    if (result.count === 0) throw new UnauthorizedException('The refresh token is invalid or already revoked.');
    return { message: 'Logged out successfully.' };
  }

  // Generates JWTs with the account identity and configured expiration periods.
  async generateTokens(userId: string, phoneNumber: string, role: string) {
    const sessionId = randomUUID();
    const payload = { sub: userId, phoneNumber, role, sid: sessionId };

    const accessSecret =
      this.configService.get<string>('jwt.accessSecret') ||
      'default_dev_access_secret_32chars';
    const refreshSecret =
      this.configService.get<string>('jwt.refreshSecret') ||
      'default_dev_refresh_secret_32chars';

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: accessSecret,
      expiresIn: this.configService.get<string>('jwt.accessExpiresIn', '15m') as `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`,
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: refreshSecret,
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn', '7d') as `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`,
    });

    return {
      accessToken,
      refreshToken,
      sessionId,
    };
  }

  // Stores a one-minute OTP hash and dispatches it through the SMS boundary.
  private async issueOtp(userId: string, phoneNumber: string, resendCount: number, verificationTries = 0) {
    const code = randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 60_000);
    await this.prisma.loginOtp.upsert({
      where: { userId },
      create: { userId, codeHash: this.hash(code), expiresAt, resendCount, verificationTries },
      update: { codeHash: this.hash(code), expiresAt, resendCount, verificationTries },
    });
    try {
      await this.smsService.sendOtp(phoneNumber, code);
    } catch (error) {
      await this.prisma.loginOtp.deleteMany({ where: { userId } });
      this.logger.error(`OTP delivery failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // Ensures only active accounts can receive login codes or authenticate.
  private ensureActive(status: string) {
    if (status !== 'ACTIVE') {
      throw new ForbiddenException('This account is not active. Please contact the administrator through the Contact Us page.');
    }
  }

  // Hashes OTP and refresh-token secrets before storing them in the database.
  private hash(value: string) {
    const secret = this.configService.get<string>('jwt.tokenHashSecret') ||
      this.configService.get<string>('jwt.refreshSecret') ||
      'development_token_hash_secret_change_before_production';
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  // Compares fixed-size hashes without a timing-sensitive string comparison.
  private matchesOtp(input: string, storedHash: string) {
    const inputHash = Buffer.from(this.hash(input), 'hex');
    const expectedHash = Buffer.from(storedHash, 'hex');
    return inputHash.length === expectedHash.length && timingSafeEqual(inputHash, expectedHash);
  }

  // Recognizes expected Prisma constraint errors for readable API responses.
  private isPrismaError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}
