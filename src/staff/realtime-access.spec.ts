import { ForbiddenException } from '@nestjs/common';
import { Socket, Namespace } from 'socket.io';
import { ChatGateway } from '../chat/chat.gateway';
import { StaffAccessEventsService } from './staff-access-events.service';
import { AdminDashboardController } from '../admin/admin-dashboard.controller';
import { UserRole } from '@prisma/client';

describe('Live realtime authorization', () => {
  it('notifies and disconnects all bound namespaces using user rooms', () => {
    const service = new StaffAccessEventsService();
    const emit = jest.fn();
    const disconnectSockets = jest.fn();
    const namespace = {
      name: '/chat',
      to: jest.fn(() => ({ emit })),
      in: jest.fn(() => ({ disconnectSockets })),
    };
    service.bind(namespace as unknown as Namespace, (id) => `chat-user:${id}`);
    service.invalidate('staff');
    expect(namespace.in).toHaveBeenCalledWith('chat-user:staff');
    expect(emit).toHaveBeenCalledWith('staff:access-changed', {
      userId: 'staff',
    });
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('rechecks chat permissions and sessions on existing socket messages', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ role: 'SUPPORT', status: 'ACTIVE' }),
      },
      refreshToken: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            userId: 'staff',
            expiresAt: new Date(Date.now() + 60000),
          }),
      },
    };
    const permissions = { require: jest.fn().mockResolvedValue({}) };
    const chat = {
      postText: jest.fn().mockResolvedValue({}),
      authorizeSocketRoom: jest.fn(),
    };
    const gateway = new ChatGateway(
      {} as never,
      {} as never,
      prisma as never,
      chat as never,
      {} as never,
      permissions as never,
      {} as never,
    );
    const client = {
      data: {
        identity: {
          userId: 'staff',
          role: 'ADMIN',
          cookie: true,
          sessionId: 'session',
          expiresAt: Date.now() + 60000,
        },
      },
      disconnect: jest.fn(),
    } as unknown as Socket;
    const body = {
      roomId: '00000000-0000-4000-8000-000000000001',
      text: 'hello',
    };
    await gateway.sendMessage(client, body);
    expect(chat.postText).toHaveBeenCalledWith(
      'staff',
      'SUPPORT',
      body.roomId,
      'hello',
    );
    permissions.require.mockRejectedValue(new ForbiddenException());
    await expect(gateway.sendMessage(client, body)).rejects.toThrow();
    expect(chat.postText).toHaveBeenCalledTimes(1);
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(gateway.sendMessage(client, body)).rejects.toThrow();
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });

  it('ends an open SSE feed after permission revocation before querying more activity', async () => {
    jest.useFakeTimers();
    const dashboard = {
      activityEvents: jest.fn().mockReturnValue({}),
      activityAfter: jest.fn().mockResolvedValue([]),
    };
    const permissions = { require: jest.fn().mockResolvedValue({}) };
    const prisma = {
      refreshToken: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            userId: 'staff',
            expiresAt: new Date(Date.now() + 60000),
          }),
      },
    };
    const controller = new AdminDashboardController(
      dashboard as never,
      permissions as never,
      prisma as never,
    );
    const errors = jest.fn();
    const subscription = controller
      .events({
        id: 'staff',
        role: UserRole.SUPPORT,
        sessionId: 'session',
        accessExpiresAt: Math.floor(Date.now() / 1000) + 60,
      })
      .subscribe({ error: errors });
    await jest.advanceTimersByTimeAsync(0);
    expect(dashboard.activityAfter).toHaveBeenCalledTimes(1);
    permissions.require.mockRejectedValue(new ForbiddenException());
    await jest.advanceTimersByTimeAsync(2000);
    expect(errors).toHaveBeenCalled();
    expect(dashboard.activityAfter).toHaveBeenCalledTimes(1);
    expect(subscription.closed).toBe(true);
    jest.useRealTimers();
  });
});
