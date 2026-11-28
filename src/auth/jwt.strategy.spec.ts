import { ConfigService } from '@nestjs/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { JwtStrategy } from './jwt.strategy';
import { STAFF_ROLES } from '../staff/staff-roles';

describe('Staff JWT sessions', () => {
  function setup(role: string) {
    const user = { id: 'user', role, status: 'ACTIVE' };
    const prisma = {
      user: { findUnique: jest.fn(async () => user) },
      refreshToken: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            userId: 'user',
            expiresAt: new Date(Date.now() + 60000),
          }),
      },
    };
    const strategy = new JwtStrategy(
      { get: () => 'secret' } as unknown as ConfigService,
      prisma as unknown as PrismaService,
    );
    const payload = { sub: 'user', sid: 'session', role, typ: 'access' };
    return { strategy, prisma, user, payload };
  }
  it.each(STAFF_ROLES)(
    'accepts %s cookies and rejects bearer credentials',
    async (role) => {
      const { strategy, payload } = setup(role);
      await expect(
        strategy.validate({ headers: {}, authMethod: 'cookie' }, payload),
      ).resolves.toMatchObject({ role, sessionId: 'session' });
      await expect(
        strategy.validate({ headers: {}, authMethod: 'bearer' }, payload),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('uses the current DB role and refuses a mobile token repackaged as a staff cookie', async () => {
    const { strategy, user, payload, prisma } = setup('ADMIN');
    user.role = 'SUPER_ADMIN';
    await expect(
      strategy.validate({ headers: {}, authMethod: 'cookie' }, payload),
    ).resolves.toMatchObject({ role: 'SUPER_ADMIN' });
    await expect(
      strategy.validate(
        { headers: {}, authMethod: 'cookie' },
        { ...payload, role: 'CUSTOMER' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(
      strategy.validate({ headers: {}, authMethod: 'cookie' }, payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
