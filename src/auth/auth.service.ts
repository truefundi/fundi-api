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
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID } from 'crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from '@simplewebauthn/server';
import { PrismaService } from '../database/prisma.service';
import { SmsService } from '../sms/sms.service';
import { RedisService } from '../redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { PinRegisterDto } from './dto/pin-register.dto';
import { UserRole, type User } from '@prisma/client';

const PASSWORD_ATTEMPT_SCRIPT = `
local attempts = tonumber(redis.call('GET', KEYS[1]) or '0')
if attempts >= tonumber(ARGV[1]) then return -1 end
attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
return attempts
`;

const CONSUME_CHALLENGE_SCRIPT = `
local challenge = redis.call('GET', KEYS[1])
if challenge then redis.call('DEL', KEYS[1]) end
return challenge
`;

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
// KEYS[2] is a separate account-scoped counter that outlives the OTP hash, so
// requesting a fresh code cannot buy back a run of guesses.
const VERIFY_OTP_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
if tonumber(redis.call('HGET', KEYS[1], 'expiresAt') or '0') <= tonumber(ARGV[3]) then
  redis.call('DEL', KEYS[1])
  return -3
end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= tonumber(ARGV[4]) then return -2 end
local verificationTries = tonumber(redis.call('HGET', KEYS[1], 'verificationTries') or '0')
if verificationTries >= tonumber(ARGV[2]) then return -2 end
if redis.call('HGET', KEYS[1], 'codeHash') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  return 1
end
redis.call('HINCRBY', KEYS[1], 'verificationTries', 1)
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
return 0
`;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpTtlSeconds: number;
  private readonly maxOtpResends = 3;
  private readonly maxOtpVerificationTries = 5;
  // Keeps an expired code around briefly so it can be reported as expired rather
  // than looking like one that was never sent. Redis still evicts it afterwards.
  private readonly otpExpiryGraceSeconds = 120;
  // Sliding window for the account-wide wrong-guess tally, so a slow trickle of
  // guesses cannot accumulate forever while a genuine typo recovers within minutes.
  private readonly otpAttemptWindowSeconds = 900;
  private readonly passwordBcryptRounds: number;
  private readonly passwordMaxAttempts: number;
  private readonly passwordLockoutSeconds: number;
  private readonly passkeyChallengeTtlSeconds: number;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private smsService: SmsService,
    private redisService: RedisService,
  ) {
    this.otpTtlSeconds = this.configService.get<number>('otp.ttlSeconds', 300);
    this.passwordBcryptRounds = this.configService.get<number>(
      'auth.passwordBcryptRounds',
      12,
    );
    this.passwordMaxAttempts = this.configService.get<number>(
      'auth.passwordMaxAttempts',
      5,
    );
    this.passwordLockoutSeconds = this.configService.get<number>(
      'auth.passwordLockoutSeconds',
      900,
    );
    this.passkeyChallengeTtlSeconds = this.configService.get<number>(
      'auth.passkeyChallengeTtlSeconds',
      300,
    );
  }

  // Customer registration is immediate; technician registration starts phone OTP verification.
  async register(input: RegisterDto) {
    this.assertPasswordLength(input.password);
    const passwordHash =
      input.password === undefined
        ? undefined
        : await bcrypt.hash(input.password, this.passwordBcryptRounds);
    try {
      const user = await this.prisma.user.create({
        data: {
          fullName: input.fullName.trim(),
          phoneNumber: input.phoneNumber,
          email: input.email || null,
          role:
            input.role === 'TECHNICIAN'
              ? UserRole.TECHNICIAN
              : UserRole.CUSTOMER,
          passwordHash,
        },
        select: { id: true, fullName: true, phoneNumber: true, role: true },
      });
      if (user.role === UserRole.TECHNICIAN) {
        await this.issueOtp(user.id, user.phoneNumber);
        return {
          message:
            'OTP generated. Verify it to complete technician registration.',
          user,
        };
      }
      return { message: 'Customer account registered successfully.', user };
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'An account with this phone number or email already exists.',
        );
      }
      throw error;
    }
  }

  // Creates a customer account with an independently stored PIN credential.
  async registerWithPin(input: PinRegisterDto) {
    this.assertPin(input.pin);
    const pinHash = await bcrypt.hash(input.pin, this.passwordBcryptRounds);
    try {
      const user = await this.prisma.user.create({
        data: {
          fullName: input.fullName.trim(),
          phoneNumber: input.phoneNumber,
          pinHash,
          role: UserRole.CUSTOMER,
        },
        select: { id: true, fullName: true, phoneNumber: true, role: true },
      });
      return { message: 'Customer account registered successfully.', user };
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'An account with this phone number already exists.',
        );
      }
      throw error;
    }
  }

  // Checks account existence and active status before creating a login OTP.
  async requestLoginOtp(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user)
      throw new NotFoundException(
        'No account was found for this phone number.',
      );
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    await this.issueOtp(user.id, user.phoneNumber);
    return {
      message: `OTP generated. It expires in ${this.otpLifetimeMinutes()} minutes.`,
    };
  }

  // Issues a replacement OTP while Redis retains its resend and attempt counters.
  async resendOtp(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user)
      throw new NotFoundException(
        'No account was found for this phone number.',
      );
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    const code = randomInt(100000, 1000000).toString();
    const resendCount = await this.runOtpScript(
      RESEND_OTP_SCRIPT,
      [this.otpKey(user.id)],
      this.hash(code),
      String(this.maxOtpResends),
      String(this.otpExpiresAt()),
      String(this.otpKeyTtlSeconds()),
    );
    if (resendCount === -1) {
      throw new BadRequestException(
        'There is no pending OTP. Request a login OTP first.',
      );
    }
    if (resendCount === -2) {
      throw new BadRequestException(
        'The maximum of three OTP resends has been reached.',
      );
    }
    await this.deliverOtp(user.id, user.phoneNumber, code);
    return {
      message: `OTP resent. ${this.maxOtpResends - resendCount} resend(s) remain.`,
    };
  }

  // Verifies a time-limited OTP and creates persisted refresh-token state.
  async verifyOtp(phoneNumber: string, otp: string) {
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user)
      throw new NotFoundException(
        'No account was found for this phone number.',
      );
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    await this.verifyOtpCode(user.id, otp);
    if (user.role === UserRole.TECHNICIAN && !user.phoneVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: new Date() },
      });
    }
    return this.createUserSession(user);
  }

  // Authenticates a customer or technician using an optional account password.
  async loginWithPassword(phoneNumber: string, password: string) {
    this.assertPasswordLength(password);
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) {
      throw new UnauthorizedException(
        'The phone number or password is incorrect.',
      );
    }
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    this.ensureTechnicianPhoneVerified(user);

    const attempts = await this.consumePasswordAttempt(user.id);
    if (attempts === -1) {
      throw new ForbiddenException(
        'Too many incorrect password attempts. Wait before trying again.',
      );
    }
    const passwordMatches =
      user.passwordHash !== null &&
      (await bcrypt.compare(password, user.passwordHash));
    if (!passwordMatches) {
      if (attempts >= this.passwordMaxAttempts) {
        throw new ForbiddenException(
          'Too many incorrect password attempts. Wait before trying again.',
        );
      }
      throw new UnauthorizedException(
        'The phone number or password is incorrect.',
      );
    }
    await this.clearPasswordAttempts(user.id);
    return this.createUserSession(user);
  }

  // Authenticates a customer or verified technician using a phone number and PIN.
  async loginWithPin(phoneNumber: string, pin: string) {
    this.assertPin(pin);
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) {
      throw new UnauthorizedException('The phone number or PIN is incorrect.');
    }
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    this.ensureTechnicianPhoneVerified(user);

    const attempts = await this.consumePasswordAttempt(user.id);
    if (attempts === -1) {
      throw new ForbiddenException(
        'Too many incorrect PIN attempts. Wait before trying again.',
      );
    }
    const pinMatches =
      user.pinHash !== null && (await bcrypt.compare(pin, user.pinHash));
    if (!pinMatches) {
      if (attempts >= this.passwordMaxAttempts) {
        throw new ForbiddenException(
          'Too many incorrect PIN attempts. Wait before trying again.',
        );
      }
      throw new UnauthorizedException('The phone number or PIN is incorrect.');
    }
    await this.clearPasswordAttempts(user.id);
    return this.createUserSession(user);
  }

  // Resets a password only after consuming an OTP sent to the account phone.
  async resetPassword(phoneNumber: string, otp: string, newPassword: string) {
    this.assertPasswordLength(newPassword);
    const user = await this.prisma.user.findUnique({ where: { phoneNumber } });
    if (!user) {
      throw new UnauthorizedException('The phone number or OTP is incorrect.');
    }
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    await this.verifyOtpCode(user.id, otp);
    await this.clearPasswordAttempts(user.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(
            newPassword,
            this.passwordBcryptRounds,
          ),
          ...(user.role === UserRole.TECHNICIAN && !user.phoneVerifiedAt
            ? { phoneVerifiedAt: new Date() }
            : {}),
        },
      });
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
    });
    return { message: 'Password reset successfully. You can now sign in.' };
  }

  // Starts passkey enrollment for the currently authenticated account.
  async generatePasskeyRegistrationOptions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    const { rpId, rpName } = this.webauthnConfiguration();
    const existingCredentials = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });
    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userID: Buffer.from(user.id),
      userName: user.phoneNumber,
      userDisplayName: user.fullName,
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: this.authenticatorTransports(credential.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
    });
    await this.storePasskeyChallenge(
      this.passkeyRegistrationChallengeKey(userId),
      options.challenge,
    );
    return options;
  }

  // Verifies and stores a device's public credential; its private key never leaves it.
  async verifyPasskeyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    const { rpId, origins } = this.webauthnConfiguration();
    const challenge = await this.consumePasskeyChallenge(
      this.passkeyRegistrationChallengeKey(userId),
    );
    if (!challenge) {
      throw new BadRequestException(
        'No passkey registration is pending or the challenge has expired. Start again.',
      );
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn(
        `Passkey registration verification failed for user ${userId}: ${this.errorMessage(error)}`,
      );
      throw new UnauthorizedException(
        'The passkey registration response could not be verified.',
      );
    }
    if (!verification.verified) {
      throw new UnauthorizedException(
        'The passkey registration response could not be verified.',
      );
    }

    const credential = verification.registrationInfo.credential;
    try {
      const saved = await this.prisma.passkeyCredential.create({
        data: {
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: BigInt(credential.counter),
          transports: this.authenticatorTransports(
            credential.transports ?? response.response.transports ?? [],
          ),
          userId,
        },
        select: { id: true, createdAt: true },
      });
      return {
        message: 'Passkey registered successfully.',
        passkey: saved,
      };
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException(
          'This passkey is already registered to an account.',
        );
      }
      throw error;
    }
  }

  // Starts a passkey sign-in challenge for a phone number and its registered credentials.
  async generatePasskeyAuthenticationOptions(phoneNumber: string) {
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber },
      include: { passkeyCredentials: true },
    });
    if (!user) {
      throw new UnauthorizedException(
        'No passkey sign-in is available for this account.',
      );
    }
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    this.ensureTechnicianPhoneVerified(user);
    if (!user.passkeyCredentials.length) {
      throw new UnauthorizedException(
        'No passkey is registered. Sign in with OTP or password first.',
      );
    }
    const { rpId } = this.webauthnConfiguration();
    const options = await generateAuthenticationOptions({
      rpID: rpId,
      userVerification: 'required',
      allowCredentials: user.passkeyCredentials.map((credential) => ({
        id: credential.credentialId,
        transports: this.authenticatorTransports(credential.transports),
      })),
    });
    await this.storePasskeyChallenge(
      this.passkeyAuthenticationChallengeKey(user.id),
      options.challenge,
    );
    return options;
  }

  // Verifies the passkey assertion, advances its signature counter, and creates a session.
  async verifyPasskeyAuthentication(
    phoneNumber: string,
    response: AuthenticationResponseJSON,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { phoneNumber },
      include: { passkeyCredentials: true },
    });
    if (!user) {
      throw new UnauthorizedException('The passkey response is invalid.');
    }
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    this.ensureTechnicianPhoneVerified(user);
    const credential = user.passkeyCredentials.find(
      (candidate) => candidate.credentialId === response.id,
    );
    if (!credential) {
      throw new UnauthorizedException('The passkey response is invalid.');
    }
    const challenge = await this.consumePasskeyChallenge(
      this.passkeyAuthenticationChallengeKey(user.id),
    );
    if (!challenge) {
      throw new BadRequestException(
        'No passkey sign-in is pending or the challenge has expired. Start again.',
      );
    }
    const { rpId, origins } = this.webauthnConfiguration();
    const storedCounter = Number(credential.counter);
    if (!Number.isSafeInteger(storedCounter)) {
      throw new UnauthorizedException('The passkey credential is invalid.');
    }

    let verification;
    try {
      const storedCredential: WebAuthnCredential = {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, 'base64url'),
        counter: storedCounter,
        transports: this.authenticatorTransports(credential.transports),
      };
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        credential: storedCredential,
        requireUserVerification: true,
      });
    } catch (error) {
      this.logger.warn(
        `Passkey authentication verification failed for user ${user.id}: ${this.errorMessage(error)}`,
      );
      throw new UnauthorizedException('The passkey response is invalid.');
    }
    if (!verification.verified) {
      throw new UnauthorizedException('The passkey response is invalid.');
    }

    const updated = await this.prisma.passkeyCredential.updateMany({
      where: {
        id: credential.id,
        userId: user.id,
        counter: credential.counter,
      },
      data: { counter: BigInt(verification.authenticationInfo.newCounter) },
    });
    if (!updated.count) {
      throw new UnauthorizedException(
        'The passkey credential has already been used. Start sign-in again.',
      );
    }
    return this.createUserSession(user);
  }

  // Returns metadata for the caller's registered passkeys without exposing keys.
  async listPasskeys(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    return this.prisma.passkeyCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, transports: true },
    });
  }

  // Revokes one of the caller's passkeys, including a lost or compromised device.
  async removePasskey(userId: string, passkeyId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Account not found.');
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    const removed = await this.prisma.passkeyCredential.deleteMany({
      where: { id: passkeyId, userId },
    });
    if (!removed.count) throw new NotFoundException('Passkey not found.');
    return { message: 'Passkey removed successfully.' };
  }

  // Deletes the matching stored refresh-token hash to end the session.
  async logout(userId: string, refreshToken: string) {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { userId, token: this.hash(refreshToken) },
    });
    if (result.count === 0)
      throw new UnauthorizedException(
        'The refresh token is invalid or already revoked.',
      );
    return { message: 'Logged out successfully.' };
  }

  // Exchanges a valid refresh token for a fresh pair and rotates the stored session.
  async refreshTokens(refreshToken: string) {
    const currentHash = this.hash(refreshToken);
    const session = await this.prisma.refreshToken.findUnique({
      where: { token: currentHash },
    });
    if (!session) {
      throw new UnauthorizedException(
        'The refresh token is invalid or already revoked.',
      );
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(
        'The refresh token has expired. Log in again.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user) {
      throw new UnauthorizedException(
        'The account associated with this token no longer exists.',
      );
    }
    // Stops a bearer session minted for an administrator before the phone flow was
    // closed from being renewed indefinitely.
    this.rejectAdminPhoneLogin(user.role);
    this.ensureActive(user.status);
    const { sessionId, ...tokens } = await this.generateTokens(
      user.id,
      user.phoneNumber,
      user.role,
    );
    const expiresAt = this.refreshTokenExpiresAt();
    const rotatedHash = this.hash(tokens.refreshToken);
    // Deleting and reinserting in one transaction keeps the old token single-use: two
    // concurrent refreshes race on the same row and only one delete can report a match.
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.deleteMany({
        where: { id: session.id, userId: user.id },
      });
      if (revoked.count === 0) {
        throw new UnauthorizedException(
          'The refresh token is invalid or already revoked.',
        );
      }
      await tx.refreshToken.create({
        data: { token: rotatedHash, sessionId, userId: user.id, expiresAt },
      });
    });
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        role: user.role,
      },
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

    // `typ` pins each token to its purpose. Without it a refresh token is a valid
    // JWT for the access-secret check whenever the two secrets are configured the
    // same, and admin and phone tokens share the same secrets in this project.
    const accessToken = await this.jwtService.signAsync(
      { ...payload, typ: 'access' },
      {
        secret: accessSecret,
        expiresIn: this.configService.get<string>(
          'jwt.accessExpiresIn',
          '7d',
        ) as `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      { ...payload, typ: 'refresh' },
      {
        secret: refreshSecret,
        expiresIn: this.configService.get<string>(
          'jwt.refreshExpiresIn',
          '30d',
        ) as `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`,
      },
    );

    return {
      accessToken,
      refreshToken,
      sessionId,
    };
  }

  // Stores OTP state in Redis with a one-minute TTL and dispatches the code.
  private async issueOtp(userId: string, phoneNumber: string) {
    const code = await this.issueOtpCode(userId);
    await this.deliverOtp(userId, phoneNumber, code);
  }

  // Creates and stores a fresh code without delivering it, so a caller that has its
  // own channel can hand the code over itself. Reused by the development-only admin
  // sign-in, which returns the code in the response instead of texting it.
  async issueOtpCode(userId: string): Promise<string> {
    return this.issueOtpForKeys(this.otpKey(userId));
  }

  private async issueOtpForKeys(otpKey: string): Promise<string> {
    const code = randomInt(100000, 1000000).toString();
    await this.runOtpScript(
      CREATE_OTP_SCRIPT,
      [otpKey],
      this.hash(code),
      '0',
      '0',
      String(this.otpExpiresAt()),
      String(this.otpKeyTtlSeconds()),
    );
    return code;
  }

  // Checks a code against the pending one and consumes it on a match, raising the
  // same errors the phone flow does on every kind of failure. Split out so the
  // development-only admin sign-in reuses this exact logic rather than a copy.
  async verifyOtpCode(userId: string, otp: string): Promise<void> {
    return this.verifyCode(this.otpKey(userId), this.otpTriesKey(userId), otp);
  }

  async requestCustomerJobOtp(customerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { id: true, phoneNumber: true, role: true, status: true },
    });
    if (!user || user.role === UserRole.ADMIN) {
      throw new NotFoundException('Account not found.');
    }
    this.ensureActive(user.status);
    const verification = await this.prisma.customerPhoneVerification.create({
      data: {
        customerId,
        expiresAt: new Date(Date.now() + this.otpTtlSeconds * 1000),
      },
    });
    const key = this.jobVerificationOtpKey(verification.id);
    try {
      const code = await this.issueOtpForKeys(key);
      await this.deliverOtp(user.id, user.phoneNumber, code, key);
    } catch (error) {
      await this.prisma.customerPhoneVerification.delete({
        where: { id: verification.id },
      });
      throw error;
    }
    return {
      verificationId: verification.id,
      expiresAt: verification.expiresAt,
      message: `OTP sent. It expires in ${this.otpLifetimeMinutes()} minutes.`,
    };
  }

  async requestTechnicianRegistrationOtp(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, phoneNumber: true, role: true, status: true },
    });
    if (!user || user.role !== UserRole.TECHNICIAN) {
      throw new NotFoundException('Technician account not found.');
    }
    this.ensureActive(user.status);
    await this.issueOtp(user.id, user.phoneNumber);
    return {
      message: `OTP generated. Verify it to activate your technician registration phone. It expires in ${this.otpLifetimeMinutes()} minutes.`,
    };
  }

  async verifyCustomerJobOtp(
    customerId: string,
    verificationId: string,
    otp: string,
  ) {
    const verification = await this.prisma.customerPhoneVerification.findFirst({
      where: {
        id: verificationId,
        customerId,
        consumedAt: null,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!verification) {
      throw new BadRequestException(
        'Phone verification is missing, expired, or already used.',
      );
    }
    await this.verifyCode(
      this.jobVerificationOtpKey(verification.id),
      this.jobVerificationOtpTriesKey(verification.id),
      otp,
    );
    const verifiedAt = new Date();
    const updated = await this.prisma.customerPhoneVerification.updateMany({
      where: {
        id: verification.id,
        customerId,
        verifiedAt: null,
        consumedAt: null,
        expiresAt: { gt: verifiedAt },
      },
      data: { verifiedAt },
    });
    if (!updated.count) {
      throw new ConflictException(
        'Phone verification expired or was already used. Request a new OTP.',
      );
    }
    await this.prisma.user.update({
      where: { id: customerId },
      data: { phoneVerifiedAt: verifiedAt },
    });
    return { verificationId: verification.id, verifiedAt };
  }

  private async verifyCode(
    otpKey: string,
    triesKey: string,
    otp: string,
  ): Promise<void> {
    const verificationResult = await this.runOtpScript(
      VERIFY_OTP_SCRIPT,
      [otpKey, triesKey],
      this.hash(otp),
      String(this.maxOtpVerificationTries),
      String(Date.now()),
      String(this.maxOtpVerificationTries),
      String(this.otpAttemptWindowSeconds),
    );
    if (verificationResult === -1) {
      throw new BadRequestException(
        'No OTP is pending. Request a new login OTP.',
      );
    }
    if (verificationResult === -3) {
      throw new UnauthorizedException(
        'The OTP has expired. Request a new login OTP.',
      );
    }
    if (verificationResult === -2) {
      throw new ForbiddenException(
        'Too many incorrect OTP attempts. Wait a few minutes before trying again.',
      );
    }
    if (verificationResult === 0) {
      throw new UnauthorizedException('The OTP is incorrect.');
    }
  }

  // Lifetime of a pending code in seconds. Exposed so the development-only admin
  // sign-in reports the same window as the phone flow instead of a hardcoded copy.
  otpLifetimeSeconds(): number {
    return this.otpTtlSeconds;
  }

  // Sends the code and clears its Redis key if delivery fails.
  private async deliverOtp(
    userId: string,
    phoneNumber: string,
    code: string,
    otpKey = this.otpKey(userId),
  ) {
    try {
      await this.smsService.sendOtp(phoneNumber, code);
    } catch (error) {
      try {
        await this.redisService.getClient().del(otpKey);
      } catch (cleanupError) {
        this.logger.error(
          `Could not clear OTP key for user ${userId}: ${this.errorMessage(cleanupError)}`,
        );
      }
      this.logger.error(
        `OTP delivery failed for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  // Executes an atomic OTP operation and translates Redis outages to a service error.
  private async runOtpScript(
    script: string,
    keys: string[],
    ...args: string[]
  ): Promise<number> {
    try {
      const result = await this.redisService
        .getClient()
        .eval(script, keys.length, ...keys, ...args);
      return Number(result);
    } catch (error) {
      this.logger.error(
        `OTP Redis operation failed: ${this.errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'OTP service is unavailable. Please try again later.',
      );
    }
  }

  // Keeps pending OTP records in a namespaced key per account.
  private otpKey(userId: string) {
    return `auth:otp:${userId}`;
  }

  // Holds the account-wide wrong-guess tally, deliberately separate from the OTP
  // hash so that issuing a new code cannot reset it.
  private otpTriesKey(userId: string) {
    return `auth:otp:tries:${userId}`;
  }

  private jobVerificationOtpKey(verificationId: string) {
    return `jobs:phone-otp:${verificationId}`;
  }

  private jobVerificationOtpTriesKey(verificationId: string) {
    return `jobs:phone-otp:tries:${verificationId}`;
  }

  private passwordAttemptsKey(userId: string) {
    return `auth:password:attempts:${userId}`;
  }

  private passkeyRegistrationChallengeKey(userId: string) {
    return `auth:passkey:registration:${userId}`;
  }

  private passkeyAuthenticationChallengeKey(userId: string) {
    return `auth:passkey:authentication:${userId}`;
  }

  private async consumePasswordAttempt(userId: string): Promise<number> {
    try {
      const result = await this.redisService
        .getClient()
        .eval(
          PASSWORD_ATTEMPT_SCRIPT,
          1,
          this.passwordAttemptsKey(userId),
          String(this.passwordMaxAttempts),
          String(this.passwordLockoutSeconds),
        );
      return Number(result);
    } catch (error) {
      this.logger.error(
        `Credential login throttling failed: ${this.errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'Credential sign-in is unavailable. Please try again later.',
      );
    }
  }

  private async clearPasswordAttempts(userId: string) {
    try {
      await this.redisService.getClient().del(this.passwordAttemptsKey(userId));
    } catch (error) {
      this.logger.error(
        `Could not clear credential attempts for user ${userId}: ${this.errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'Credential sign-in is unavailable. Please try again later.',
      );
    }
  }

  private async storePasskeyChallenge(key: string, challenge: string) {
    try {
      await this.redisService
        .getClient()
        .set(key, challenge, 'EX', this.passkeyChallengeTtlSeconds);
    } catch (error) {
      this.logger.error(
        `Could not store passkey challenge: ${this.errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'Passkey authentication is unavailable. Please try again later.',
      );
    }
  }

  private async consumePasskeyChallenge(key: string): Promise<string | null> {
    try {
      const challenge = await this.redisService
        .getClient()
        .eval(CONSUME_CHALLENGE_SCRIPT, 1, key);
      return typeof challenge === 'string' ? challenge : null;
    } catch (error) {
      this.logger.error(
        `Could not consume passkey challenge: ${this.errorMessage(error)}`,
      );
      throw new ServiceUnavailableException(
        'Passkey authentication is unavailable. Please try again later.',
      );
    }
  }

  private webauthnConfiguration() {
    const rpId = this.configService.get<string>('webauthn.rpId');
    const origins = this.configService.get<string[]>('webauthn.origins', []);
    if (!rpId || !origins.length) {
      throw new ServiceUnavailableException(
        'Passkey authentication is not configured. Set WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN.',
      );
    }
    return {
      rpId,
      origins,
      rpName: this.configService.get<string>('webauthn.rpName', 'Fundi'),
    };
  }

  private authenticatorTransports(transports: string[]): string[] {
    const allowed = new Set(['ble', 'hybrid', 'internal', 'nfc', 'usb']);
    return transports.filter((transport) => allowed.has(transport));
  }

  private ensureTechnicianPhoneVerified(user: {
    role: string;
    phoneVerifiedAt: Date | null;
  }) {
    if (user.role === UserRole.TECHNICIAN && !user.phoneVerifiedAt) {
      throw new ForbiddenException(
        'Verify the technician account phone with OTP before signing in.',
      );
    }
  }

  private assertPasswordLength(password: string | undefined) {
    if (password === undefined) return;
    const bytes = Buffer.byteLength(password, 'utf8');
    if (bytes < 8 || bytes > 72) {
      throw new BadRequestException(
        'Passwords must be between 8 and 72 bytes when encoded as UTF-8.',
      );
    }
  }

  private assertPin(pin: string) {
    if (!/^\d{4,6}$/.test(pin)) {
      throw new BadRequestException('PINs must contain 4 to 6 digits.');
    }
  }

  private async createUserSession(
    user: Pick<User, 'id' | 'fullName' | 'phoneNumber' | 'role'>,
  ) {
    const { sessionId, ...tokens } = await this.generateTokens(
      user.id,
      user.phoneNumber,
      user.role,
    );
    await this.prisma.refreshToken.create({
      data: {
        token: this.hash(tokens.refreshToken),
        sessionId,
        userId: user.id,
        expiresAt: this.refreshTokenExpiresAt(),
      },
    });
    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        role: user.role,
      },
      ...tokens,
    };
  }

  // Absolute expiry stamp stored on the hash and treated as authoritative.
  private otpExpiresAt(): number {
    return Date.now() + this.otpTtlSeconds * 1000;
  }

  // Whole minutes the code stays usable, for the messages shown to callers.
  private otpLifetimeMinutes(): number {
    return Math.round(this.otpTtlSeconds / 60);
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

  // Administrators never hold bearer tokens: their session is an httpOnly cookie
  // issued only after password + authenticator verification. Letting an ADMIN
  // account through the phone-OTP flow would mint a token that admin routes accept,
  // turning a texted code into full dashboard access.
  private rejectAdminPhoneLogin(role: string) {
    if (role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrators must sign in through the admin portal.',
      );
    }
  }

  // Ensures only active accounts can receive login codes or authenticate.
  private ensureActive(status: string) {
    if (status !== 'ACTIVE') {
      throw new ForbiddenException(
        'This account is not active. Please contact the administrator through the Contact Us page.',
      );
    }
  }

  // Converts a JWT duration such as 30d or 7d into seconds so the stored session
  // expiry can follow the configured token lifetime instead of a fixed constant.
  private durationToSeconds(value: string): number {
    const match = /^(\d+)\s*(s|m|h|d|w|y)?$/i.exec(String(value).trim());
    if (!match) return 30 * 24 * 60 * 60;
    const units: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
      y: 31536000,
    };
    return Number(match[1]) * units[(match[2] || 's').toLowerCase()];
  }

  // Expiry stored on a refresh-token row, kept in step with jwt.refreshExpiresIn.
  private refreshTokenExpiresAt(): Date {
    return new Date(
      Date.now() +
        this.durationToSeconds(
          this.configService.get<string>('jwt.refreshExpiresIn', '30d'),
        ) *
          1000,
    );
  }

  // Hashes OTP and refresh-token secrets before storing them in the database.
  private hash(value: string) {
    const secret =
      this.configService.get<string>('jwt.tokenHashSecret') ||
      this.configService.get<string>('jwt.refreshSecret') ||
      'development_token_hash_secret_change_before_production';
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  // Recognizes expected Prisma constraint errors for readable API responses.
  private isPrismaError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === code
    );
  }
}
