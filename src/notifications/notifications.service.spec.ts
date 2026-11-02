import { NotificationType } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from '../websockets/events.gateway';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let prisma: any;
  let events: jest.Mocked<EventsGateway>;
  let audit: jest.Mocked<AuditService>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = {
      notification: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    events = {
      notifyUser: jest.fn(),
    } as any;
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    } as any;

    (prisma.$transaction as jest.Mock).mockImplementation((ops: any[]) => Promise.all(ops));

    service = new NotificationsService(prisma as PrismaService, events, audit);
  });

  describe('create', () => {
    it('creates a notification and emits socket event', async () => {
      const created = {
        id: 'n1',
        userId: 'u1',
        type: NotificationType.JOB_OFFER,
        title: 'New job offer',
        body: 'You have a new job offer.',
        data: { jobId: 'j1' },
        readAt: null,
        createdAt: new Date(),
      };
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.notification.create as jest.Mock).mockResolvedValue(created);

      const result = await service.create({
        userId: 'u1',
        type: NotificationType.JOB_OFFER,
        title: 'New job offer',
        body: 'You have a new job offer.',
        data: { jobId: 'j1' },
      });

      expect(prisma.notification.create).toHaveBeenCalled();
      expect(events.notifyUser).toHaveBeenCalledWith('u1', 'notification:new', expect.objectContaining({ id: 'n1' }));
      expect(result.id).toBe('n1');
    });

    it('deduplicates by dedupeKey when unread notification exists', async () => {
      const existing = {
        id: 'n1',
        userId: 'u1',
        type: NotificationType.JOB_OFFER,
        title: 't',
        body: 'b',
        data: { dedupeKey: 'job-offer:o1' },
        readAt: null,
        createdAt: new Date(),
      };
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(existing);

      const result = await service.create({
        userId: 'u1',
        type: NotificationType.JOB_OFFER,
        title: 't',
        body: 'b',
        data: { dedupeKey: 'job-offer:o1' },
      } as any);

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(events.notifyUser).not.toHaveBeenCalled();
      expect(result.id).toBe('n1');
    });

    it('deduplicates using explicit dedupeKey field', async () => {
      const existing = {
        id: 'n2',
        userId: 'u1',
        type: NotificationType.OFFER_ACCEPTED,
        title: 't',
        body: 'b',
        data: { dedupeKey: 'offer-accepted:off1' },
        readAt: null,
        createdAt: new Date(),
      };
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(existing);

      const result = await service.create({
        userId: 'u1',
        type: NotificationType.OFFER_ACCEPTED,
        title: 't',
        body: 'b',
        dedupeKey: 'offer-accepted:off1',
      } as any);

      expect(prisma.notification.create).not.toHaveBeenCalled();
      expect(result.id).toBe('n2');
    });
  });

  describe('list', () => {
    it('returns paginated notifications', async () => {
      const items = [
        { id: 'n1', userId: 'u1', type: NotificationType.SYSTEM, title: 't', body: 'b', data: null, readAt: null, createdAt: new Date() },
      ];
      (prisma.notification.findMany as jest.Mock).mockResolvedValue(items);
      (prisma.notification.count as jest.Mock).mockResolvedValue(1);

      const result = await service.list('u1', { limit: 10, offset: 0 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('filters unread only', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.notification.count as jest.Mock).mockResolvedValue(0);

      await service.list('u1', { limit: 10, offset: 0, unreadOnly: true });
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', readAt: null } }),
      );
    });
  });

  describe('unreadCount', () => {
    it('counts unread notifications', async () => {
      (prisma.notification.count as jest.Mock).mockResolvedValue(5);
      const result = await service.unreadCount('u1');
      expect(result.count).toBe(5);
      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: 'u1', readAt: null } });
    });
  });

  describe('markRead', () => {
    it('marks a notification as read and audits', async () => {
      const notification = { id: 'n1', userId: 'u1', readAt: null };
      const updated = { ...notification, readAt: new Date() };
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(notification);
      (prisma.notification.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.markRead('u1', 'n1');
      expect(prisma.notification.update).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'NOTIFICATION_READ',
          entityId: 'n1',
          actorId: 'u1',
        }),
      );
      expect(result.readAt).not.toBeNull();
    });

    it('returns existing notification if already read (idempotent)', async () => {
      const notification = { id: 'n1', userId: 'u1', readAt: new Date() };
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(notification);

      const result = await service.markRead('u1', 'n1');
      expect(prisma.notification.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
      expect(result.id).toBe('n1');
    });

    it('throws NotFoundException if notification does not belong to user', async () => {
      (prisma.notification.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.markRead('u1', 'n1')).rejects.toThrow('Notification not found.');
    });
  });

  describe('markAllRead', () => {
    it('marks all unread notifications as read and audits', async () => {
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await service.markAllRead('u1');
      expect(result.updated).toBe(3);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'NOTIFICATIONS_READ_ALL',
          actorId: 'u1',
          metadata: { count: 3 },
        }),
      );
    });

    it('does not audit when nothing updated', async () => {
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const result = await service.markAllRead('u1');
      expect(result.updated).toBe(0);
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
