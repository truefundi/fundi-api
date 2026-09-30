import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RedisService } from '../redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { UserRole } from '@prisma/client';

// Creates the initial OTP hash and applies its Redis TTL atomically. The absolute
// expiry is stored as a field so an expired code stays distinguishable from one
// that was never sent, and the key outlives the code to allow that.
const CREATE_OTP_SCRIPT = `
redis.call('HSET', KEYS[1], 'codeHash', ARGV[1], 'resendCount', ARGV[2], 'verificationTries', ARGV[3], 'expiresAt', ARGV[4])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
return 1
`;

// Atomically enforces resend limits while replacing the code and expiry. The
// failed-attempt counter is carried over so resending cannot clear a run of
// wrong guesses.
const RESEND_OTP_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local resendCount = tonumber(redis.call('HGET', KEYS[1], 'resendCount') or '0')
if resendCount >= tonumber(ARGV[2]) then return -2 end
local verificationTries = redis.call('HGET', KEYS[1], 'verificationTries') or '0'
local nextResendCount = resendCount + 1
redis.call('HSET', KEYS[1], 'codeHash', ARGV[1], 'resendCount', nextResendCount, 'verificationTries', verificationTries, 'expiresAt', ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return nextResendCount
`;

// Atomically checks and consumes a code or increments its failed-attempt count.
// Returns -1 when nothing is pending, -3 when the code has passed its expiry, -2
// once the attempt limit is reached, 1 on success and 0 on a wrong guess.
const VERIFY_OTP_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  return -3
end
local verificationTries = tonumber(redis.call('HGET', KEYS[1], 'verificationTries') or '0')
if verificationTries >= tonumber(ARGV[2]) then return -2 end
if redis.call('HGET', KEYS[1], 'codeHash') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
redis.call('HINCRBY', KEYS[1], 'verificationTries', 1)
return 0
`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpTtlSeconds = 60;
  private readonly maxOtpResends = 3;
  private readonly maxOtpVerificationTries = 5;
  // Keeps an expired code around briefly so it can be reported as expired rather
  // than looking like one that was never sent. Redis still evicts it afterwards.
  private readonly otpExpiryGraceSeconds = 120;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private smsService: SmsService,
    private redisService: RedisService,
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
      await this.issueOtp(user.id, user.phoneNumber);
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
    await this.issueOtp(user.id, user.phoneNumber);
    return { message: 'OTP generated. It expires in one minute.' };
  }

  // Issues a replacement OTP while Redis retains its resend and attempt counters.
  async resendOtp(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) throw new NotFoundException('No account was found for this phone number.');
    this.ensureActive(user.status);
    const code = randomInt(100000, 1000000).toString();
    const resendCount = await this.runOtpScript(
      RESEND_OTP_SCRIPT,
      this.otpKey(user.id),
      this.hash(code),
      String(this.maxOtpResends),
      String(this.otpExpiresAt()),
      String(this.otpKeyTtlSeconds()),
    );
    if (resendCount === -1) {
      throw new BadRequestException('There is no pending OTP. Request a login OTP first.');
    }
    if (resendCount === -2) {
      throw new BadRequestException('The maximum of three OTP resends has been reached.');
    }
    await this.deliverOtp(user.id, user.phoneNumber, code);
    return { message: `OTP resent. ${this.maxOtpResends - resendCount} resend(s) remain.` };
  }

  // Verifies a time-limited OTP and creates persisted refresh-token state.
  async verifyOtp(phoneNumber: string, otp: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) throw new NotFoundException('No account was found for this phone number.');
    this.ensureActive(user.status);
    const verificationResult = await this.runOtpScript(
      VERIFY_OTP_SCRIPT,
      this.otpKey(user.id),
      this.hash(otp),
      String(this.maxOtpVerificationTries),
      String(Date.now()),
    );
    if (verificationResult === -1) {
      throw new BadRequestException('No OTP is pending. Request a new login OTP.');
    }
    if (verificationResult === -3) {
      throw new UnauthorizedException('The OTP has expired. Request a new login OTP.');
    }
    if (verificationResult === -2) {
      throw new ForbiddenException('Too many incorrect OTP attempts. Request a new login OTP.');
    }
    if (verificationResult === 0) {
      throw new UnauthorizedException('The OTP is incorrect.');
    }
    const { sessionId, ...tokens } = await this.generateTokens(user.id, user.phoneNumber, user.role);
    const refreshHash = this.hash(tokens.refreshToken);
    const refreshExpiresAt = this.refreshTokenExpiresAt();
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

  // Exchanges a valid refresh token for a fresh pair and rotates the stored session.
  async refreshTokens(refreshToken: string) {
    const currentHash = this.hash(refreshToken);
    const session = await this.prisma.refreshToken.findUnique({ where: { token: currentHash } });
    if (!session) {
      throw new UnauthorizedException('The refresh token is invalid or already revoked.');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('The refresh token has expired. Log in again.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      throw new UnauthorizedException('The account associated with this token no longer exists.');
    }
    this.ensureActive(user.status);
    const { sessionId, ...tokens } = await this.generateTokens(user.id, user.phoneNumber, user.role);
    const expiresAt = this.refreshTokenExpiresAt();
    const rotatedHash = this.hash(tokens.refreshToken);
    // Deleting and reinserting in one transaction keeps the old token single-use: two
    // concurrent refreshes race on the same row and only one delete can report a match.
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.deleteMany({ where: { id: session.id, userId: user.id } });
      if (revoked.count === 0) {
        throw new UnauthorizedException('The refresh token is invalid or already revoked.');
      }
      await tx.refreshToken.create({
        data: { token: rotatedHash, sessionId, userId: user.id, expiresAt },
      });
    });
    return {
      user: { id: user.id, fullName: user.fullName, phoneNumber: user.phoneNumber, role: user.role },
      ...tokens,
    };
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

  // Stores OTP state in Redis with a one-minute TTL and dispatches the code.
  private async issueOtp(userId: string, phoneNumber: string) {
    const code = randomInt(100000, 1000000).toString();
    await this.runOtpScript(
      CREATE_OTP_SCRIPT,
      this.otpKey(userId),
      this.hash(code),
      '0',
      '0',
      String(this.otpExpiresAt()),
      String(this.otpKeyTtlSeconds()),
    );
    await this.deliverOtp(userId, phoneNumber, code);
  }

  // Sends the code and clears its Redis key if delivery fails.
  private async deliverOtp(userId: string, phoneNumber: string, code: string) {
    try {
      await this.smsService.sendOtp(phoneNumber, code);
    } catch (error) {
      try {
        await this.redisService.getClient().del(this.otpKey(userId));
      } catch (cleanupError) {
        this.logger.error(`Could not clear OTP key for user ${userId}: ${this.errorMessage(cleanupError)}`);
      }
      this.logger.error(`OTP delivery failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  // Executes an atomic OTP operation and translates Redis outages to a service error.
  private async runOtpScript(script: string, key: string, ...args: string[]): Promise<number> {
    try {
      const result = await this.redisService.getClient().eval(script, 1, key, ...args);
      return Number(result);
    } catch (error) {
      this.logger.error(`OTP Redis operation failed: ${this.errorMessage(error)}`);
      throw new ServiceUnavailableException('OTP service is unavailable. Please try again later.');
    }
  }

  // Keeps pending OTP records in a namespaced key per account.
  private otpKey(userId: string) {
    return `auth:otp:${userId}`;
  }

  // Absolute expiry stamp stored on the hash and treated as authoritative.
  private otpExpiresAt(): number {
    return Date.now() + this.otpTtlSeconds * 1000;
  }

  // Redis key lifetime, which outlives the code by the grace period so an
  // expired code can still be identified as expired.
  private otpKeyTtlSeconds(): number {
    return this.otpTtlSeconds + this.otpExpiryGraceSeconds;
  }

  // Formats unknown errors for diagnostic logs without hiding the cause.
  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  // Ensures only active accounts can receive login codes or authenticate.
  private ensureActive(status: string) {
    if (status !== 'ACTIVE') {
      throw new ForbiddenException('This account is not active. Please contact the administrator through the Contact Us page.');
    }
  }

  // Converts a JWT duration such as 7d or 15m into seconds so the stored session
  // expiry can follow the configured token lifetime instead of a fixed constant.
  private durationToSeconds(value: string): number {
    const match = /^(\d+)\s*(s|m|h|d|w|y)?$/i.exec(String(value).trim());
    if (!match) return 7 * 24 * 60 * 60;
    const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 };
    return Number(match[1]) * units[(match[2] || 's').toLowerCase()];
  }

  // Expiry stored on a refresh-token row, kept in step with jwt.refreshExpiresIn.
  private refreshTokenExpiresAt(): Date {
    return new Date(Date.now() + this.durationToSeconds(this.configService.get<string>('jwt.refreshExpiresIn', '7d')) * 1000);
  }

  // Hashes OTP and refresh-token secrets before storing them in the database.
  private hash(value: string) {
    const secret = this.configService.get<string>('jwt.tokenHashSecret') ||
      this.configService.get<string>('jwt.refreshSecret') ||
      'development_token_hash_secret_change_before_production';
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  // Recognizes expected Prisma constraint errors for readable API responses.
  private isPrismaError(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
  }
}
