import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from './events.gateway';

describe('Authenticated event rooms', () => {
  function setup(role = 'ADMIN') {
    const jwt = {
      verifyAsync: jest
        .fn()
        .mockResolvedValue({
          sub: 'user-1',
          sid: 'session-1',
          typ: 'access',
          role,
        }),
    };
    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 'user-1',
          expiresAt: new Date(Date.now() + 60000),
        }),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', role, status: 'ACTIVE' }),
      },
    };
    const gateway = new EventsGateway(
      jwt as unknown as JwtService,
      {
        get: jest.fn().mockReturnValue('test-secret'),
      } as unknown as ConfigService,
      prisma as unknown as PrismaService,
      { bind: jest.fn(), invalidate: jest.fn() } as never,
      { require: jest.fn().mockResolvedValue({}) } as never,
    );
    return { gateway, jwt, prisma };
  }
  function socket(cookie?: string) {
    return {
      id: 'socket-1',
      handshake: { auth: { accessToken: 'bearer-token' }, headers: { cookie } },
      join: jest.fn(),
    };
  }

  it('uses the dashboard cookie ahead of stale auth tokens and joins only its user room', async () => {
    const { gateway, jwt } = setup();
    const client = socket('other=value; fundi_admin_access=admin-token');
    await gateway.handleConnection(client as unknown as Socket);
    expect(jwt.verifyAsync).toHaveBeenCalledWith(
      'admin-token',
      expect.anything(),
    );
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    expect(client.join).toHaveBeenCalledTimes(1);
  });

  it('rejects bearer-only admin identity and revoked sessions', async () => {
    const { gateway, prisma } = setup();
    const bearer = socket();
    await gateway.handleConnection(bearer as unknown as Socket);
    expect(bearer.join).not.toHaveBeenCalled();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    const revoked = socket('fundi_admin_access=admin-token');
    await gateway.handleConnection(revoked as unknown as Socket);
    expect(revoked.join).not.toHaveBeenCalled();
  });

  it('retains bearer authentication for client payment updates and rejects refresh tokens', async () => {
    const { gateway, jwt } = setup('CUSTOMER');
    const client = socket();
    await gateway.handleConnection(client as unknown as Socket);
    expect(client.join).toHaveBeenCalledWith('user:user-1');
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      sid: 'session-1',
      typ: 'refresh',
      role: 'CUSTOMER',
    });
    client.join.mockClear();
    await gateway.handleConnection(client as unknown as Socket);
    expect(client.join).not.toHaveBeenCalled();
  });
});
