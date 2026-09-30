import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('jwt.accessSecret') ||
        'default_dev_access_secret_32chars',
    });
  }

  // Confirms the token subject still exists and is an active account.
  async validate(payload: { sub: string; phoneNumber: string; role: string; sid: string }) {
    if (!payload?.sub || !payload.sid) {
      throw new UnauthorizedException('The access token is missing its account session.');
    }
    const session = await this.prisma.refreshToken.findUnique({ where: { sessionId: payload.sid } });
    if (!session || session.userId !== payload.sub || session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('The login session is expired or has been revoked.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('The account associated with this token no longer exists.');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is not active. Please contact the administrator.');
    return { userId: user.id, phoneNumber: user.phoneNumber, role: user.role };
  }
}
