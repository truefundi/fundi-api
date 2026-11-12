import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Broadcast,
  BroadcastChannel,
  BroadcastRole,
  BroadcastStatus,
  NotificationType,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { BroadcastsService } from './broadcasts.service';
import { SendBroadcastDto } from './dto/broadcast.dto';

const recipients = [
  { id: 'user-1', phoneNumber: '+250788111111' },
  { id: 'user-2', phoneNumber: '+250788222222' },
];

const baseBroadcast: Broadcast = {
  id: 'broadcast-1',
  title: 'Important service update',
  message: 'Fundi will be unavailable tonight.',
  roles: [BroadcastRole.CUSTOMER],
  channels: [BroadcastChannel.IN_APP],
  status: BroadcastStatus.SENDING,
  mode: 'queued',
  userCount: 2,
  smsRecipientCount: 0,
  inAppRecipientCount: 2,
  smsSentCount: 0,
  smsFailedCount: 0,
  inAppSentCount: 0,
  error: null,
  sentAt: null,
  createdById: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('BroadcastsService', () => {
  const createService = () => {
    const prisma: any = {
      user: { findMany: jest.fn().mockResolvedValue(recipients) },
      broadcast: {
        create: jest.fn().mockResolvedValue(baseBroadcast),
        update: jest.fn().mockImplementation(async ({ data }: { data: object }) => ({
          ...baseBroadcast,
          ...data,
        })),
        findMany: jest.fn().mockResolvedValue([baseBroadcast]),
        findUnique: jest.fn().mockResolvedValue(baseBroadcast),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn(async (input: unknown) =>
        Array.isArray(input) ? Promise.all(input) : (input as (tx: unknown) => unknown)(prisma),
      ),
    };
    const notifications = {
      createManyForUsers: jest.fn().mockResolvedValue(recipients.length),
    };
    const sms = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new BroadcastsService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      sms as unknown as SmsService,
      audit as unknown as AuditService,
    );
    return { service, prisma, notifications, sms, audit };
  };

  const inAppOnly: SendBroadcastDto = {
    title: 'Important service update',
    message: 'Fundi will be unavailable tonight.',
    audience: { roles: [BroadcastRole.CUSTOMER], status: 'active' },
    channels: [BroadcastChannel.IN_APP],
  };

  it('counts the active audience before sending', async () => {
    const { service, prisma } = createService();

    await expect(
      service.preview({ roles: [BroadcastRole.CUSTOMER], status: 'active' }),
    ).resolves.toEqual({
      userCount: 2,
      smsRecipientCount: 2,
      inAppRecipientCount: 2,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        role: { in: [UserRole.CUSTOMER] },
        status: UserStatus.ACTIVE,
      },
      select: { id: true, phoneNumber: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('writes in-app notifications and marks a fully delivered broadcast SENT', async () => {
    const { service, prisma, notifications, sms, audit } = createService();

    const result = await service.send('admin-1', inAppOnly);

    expect(prisma.broadcast.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roles: [BroadcastRole.CUSTOMER],
        channels: [BroadcastChannel.IN_APP],
        userCount: 2,
        smsRecipientCount: 0,
        inAppRecipientCount: 2,
        createdById: 'admin-1',
      }),
    });
    expect(notifications.createManyForUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['user-1', 'user-2'],
        type: NotificationType.BROADCAST,
        title: inAppOnly.title,
        body: inAppOnly.message,
        data: { broadcastId: baseBroadcast.id },
      }),
    );
    expect(sms.sendMessage).not.toHaveBeenCalled();
    expect(result.status).toBe(BroadcastStatus.SENT);
    expect(result.inAppSentCount).toBe(2);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'BROADCAST_SENT',
        actorId: 'admin-1',
        toStatus: BroadcastStatus.SENT,
      }),
    );
  });

  it('sends SMS to every recipient when both channels are selected', async () => {
    const { service, sms } = createService();

    const result = await service.send('admin-1', {
      ...inAppOnly,
      channels: [BroadcastChannel.IN_APP, BroadcastChannel.SMS],
    });

    expect(sms.sendMessage).toHaveBeenCalledTimes(2);
    expect(sms.sendMessage).toHaveBeenCalledWith(
      '+250788111111',
      `${inAppOnly.title}: ${inAppOnly.message}`,
    );
    expect(result.status).toBe(BroadcastStatus.SENT);
    expect(result.smsSentCount).toBe(2);
    expect(result.smsFailedCount).toBe(0);
  });

  it('reports PARTIAL when some SMS deliveries fail', async () => {
    const { service, sms } = createService();
    sms.sendMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Provider rejected the number.'));

    const result = await service.send('admin-1', {
      ...inAppOnly,
      channels: [BroadcastChannel.SMS],
    });

    expect(result.status).toBe(BroadcastStatus.PARTIAL);
    expect(result.smsSentCount).toBe(1);
    expect(result.smsFailedCount).toBe(1);
    expect(result.error).toContain('Provider rejected the number.');
  });

  it('reports FAILED when no channel delivered anything', async () => {
    const { service, sms } = createService();
    sms.sendMessage.mockRejectedValue(new Error('SMS provider is not configured.'));

    const result = await service.send('admin-1', {
      ...inAppOnly,
      channels: [BroadcastChannel.SMS],
    });

    expect(result.status).toBe(BroadcastStatus.FAILED);
    expect(result.smsSentCount).toBe(0);
  });

  it('refuses an audience with no active recipients', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([]);

    await expect(service.send('admin-1', inAppOnly)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.broadcast.create).not.toHaveBeenCalled();
  });

  it('returns a broadcast by id and reports a missing one', async () => {
    const { service, prisma } = createService();

    await expect(service.get('broadcast-1')).resolves.toMatchObject({
      id: 'broadcast-1',
      audience: { roles: [BroadcastRole.CUSTOMER], status: 'active' },
    });

    prisma.broadcast.findUnique.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
