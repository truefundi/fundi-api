import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { ADMIN_ACCESS_COOKIE } from './admin-cookies';

// How a request proved who it is. The extractor list alone cannot report this, so
// `authMethod` is tagged onto the request by whichever extractor matched. Guards
// that need to keep cookie sessions away from a route read it from there.
export type AuthMethod = 'bearer' | 'cookie';

interface JwtRequest {
  headers: { authorization?: string };
  cookies?: Record<string, string>;
  authMethod?: AuthMethod;
}

// passport-jwt 4 ships no cookie extractor, so this reads the parsed cookie
// directly. `req.cookies` is populated by cookie-parser in main.ts.
function fromAdminAccessCookie(request: JwtRequest): string | null {
  return request.cookies?.[ADMIN_ACCESS_COOKIE] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService, private prisma: PrismaService) {
    super({
      // Bearer first, so mobile clients are unaffected and an explicit header
      // always wins. The admin httpOnly cookie is the fallback for the dashboard.
      jwtFromRequest: (request: JwtRequest) => {
        const fromHeader = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
        if (fromHeader) {
          request.authMethod = 'bearer';
          return fromHeader;
        }
        const fromCookie = fromAdminAccessCookie(request);
        if (fromCookie) request.authMethod = 'cookie';
        return fromCookie;
      },
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
