import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { EventsGateway } from '../websockets/events.gateway';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  dedupeKey?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates a notification and emits `notification:new` to the user if connected.
   * When `dedupeKey` is provided via `data.dedupeKey` or the explicit field, we
   * avoid creating a duplicate notification within a short window by reusing an
   * unread notification with the same dedupe key. This keeps idempotent callers
   * from spamming the inbox.
   */
  async create(input: CreateNotificationInput) {
    const data = {
      ...(typeof input.data === 'object' && input.data !== null
        ? (input.data as Record<string, unknown>)
        : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    } as Prisma.InputJsonValue;

    const dedupeKey =
      input.dedupeKey ??
      (typeof data === 'object' && data !== null && 'dedupeKey' in data
        ? (data as Record<string, unknown>).dedupeKey
        : undefined);

    if (dedupeKey !== undefined && dedupeKey !== null) {
      const dedupeStr = String(dedupeKey);
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId: input.userId,
          readAt: null,
          data: {
            path: ['dedupeKey'],
            equals: dedupeStr,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        return this.toResponse(existing);
      }
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data,
      },
    });

    const payload = this.toResponse(notification);
    this.events.notifyUser(input.userId, 'notification:new', payload);
    return payload;
  }

  /**
   * Creates the same notification for many users in one round trip per chunk and
   * emits `notification:new` to each connected socket. Broadcasts use this instead
   * of calling `create` once per recipient, which would issue a query per user.
   */
  async createManyForUsers(input: {
    userIds: string[];
    type: NotificationType;
    title: string;
    body: string;
    data?: Prisma.InputJsonValue;
  }): Promise<number> {
    if (input.userIds.length === 0) return 0;

    const now = new Date();
    let created = 0;
    // Keeps each INSERT inside Postgres' bind-parameter limit for large audiences.
    for (let index = 0; index < input.userIds.length; index += 500) {
      const rows = input.userIds.slice(index, index + 500).map((userId) => ({
        id: randomUUID(),
        userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
        createdAt: now,
      }));
      const result = await this.prisma.notification.createMany({ data: rows });
      created += result.count;
      for (const row of rows) {
        this.events.notifyUser(row.userId, 'notification:new', {
          id: row.id,
          userId: row.userId,
          type: row.type,
          title: row.title,
          body: row.body,
          data: row.data ?? null,
          readAt: null,
          createdAt: row.createdAt,
        });
      }
    }
    return created;
  }

  async list(userId: string, query: { limit: number; offset: number; unreadOnly?: boolean }) {
    const where: Prisma.NotificationWhereInput = { userId };
    if (query.unreadOnly) {
      where.readAt = null;
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new (await import('@nestjs/common')).NotFoundException('Notification not found.');
    }
    if (notification.readAt) {
      return this.toResponse(notification);
    }
    const updated = await this.prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });
    await this.audit.log({
      entityType: 'Notification',
      entityId: notification.id,
      action: 'NOTIFICATION_READ',
      actorId: userId,
      metadata: { userId },
    });
    return this.toResponse(updated);
  }

  async markAllRead(userId: string) {
    const now = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: now },
    });
    if (result.count > 0) {
      await this.audit.log({
        entityType: 'Notification',
        entityId: userId,
        action: 'NOTIFICATIONS_READ_ALL',
        actorId: userId,
        metadata: { count: result.count },
      });
    }
    return { updated: result.count };
  }

  private toResponse(notification: Prisma.NotificationGetPayload<{}>) {
    return {
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    };
  }
}
