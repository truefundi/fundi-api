import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
import { BroadcastResponseDto } from './dto/broadcast-response.dto';
import {
  BroadcastAudienceDto,
  ListBroadcastsQueryDto,
  SendBroadcastDto,
} from './dto/broadcast.dto';

interface Recipient {
  id: string;
  phoneNumber: string;
}

export interface AudienceCounts {
  userCount: number;
  smsRecipientCount: number;
  inAppRecipientCount: number;
}

// Sends an administrator message to active customers and/or technicians. In-app
// delivery reuses the notification inbox; SMS goes through the same provider boundary
// as OTPs, so the console driver logs the message in development.
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
  ) {}

  // The compose screen calls this before sending so the operator sees how many people
  // and phone numbers the selection reaches.
  async preview(audience: BroadcastAudienceDto): Promise<AudienceCounts> {
    const recipients = await this.resolveRecipients(audience.roles);
    return {
      userCount: recipients.length,
      smsRecipientCount: recipients.filter((user) => user.phoneNumber.trim().length > 0)
        .length,
      // Every recipient has an inbox, so the in-app reach equals the audience size.
      inAppRecipientCount: recipients.length,
    };
  }

  async list(query: ListBroadcastsQueryDto) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.broadcast.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit ?? 20,
        skip: query.offset ?? 0,
      }),
      this.prisma.broadcast.count(),
    ]);
    return {
      items: items.map((broadcast) => this.toResponse(broadcast)),
      total,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    };
  }

  async get(id: string) {
    return this.toResponse(await this.requireBroadcast(id));
  }

  // Sends immediately: the dashboard has no draft or schedule step. The audience and
  // counts are frozen on the row, so the history still reads correctly after users
  // join or leave.
  async send(adminId: string, dto: SendBroadcastDto) {
    const roles = [...new Set(dto.audience.roles)];
    const channels = [...new Set(dto.channels)];
    if (roles.length === 0) {
      throw new BadRequestException('Select at least one recipient group.');
    }
    if (channels.length === 0) {
      throw new BadRequestException('Select at least one delivery channel.');
    }

    const recipients = await this.resolveRecipients(roles);
    if (recipients.length === 0) {
      throw new BadRequestException(
        'There are no active recipients in the selected groups.',
      );
    }

    const smsRequested = channels.includes(BroadcastChannel.SMS);
    const inAppRequested = channels.includes(BroadcastChannel.IN_APP);
    const smsRecipients = smsRequested
      ? recipients.filter((user) => user.phoneNumber.trim().length > 0)
      : [];

    const broadcast = await this.prisma.broadcast.create({
      data: {
        title: dto.title,
        message: dto.message,
        roles,
        channels,
        status: BroadcastStatus.SENDING,
        mode: 'queued',
        userCount: recipients.length,
        smsRecipientCount: smsRecipients.length,
        inAppRecipientCount: inAppRequested ? recipients.length : 0,
        createdById: adminId,
      },
    });

    let inAppSent = 0;
    let smsSent = 0;
    let smsFailed = 0;
    const failures: string[] = [];

    if (inAppRequested) {
      inAppSent = await this.notifications.createManyForUsers({
        userIds: recipients.map((user) => user.id),
        type: NotificationType.BROADCAST,
        title: dto.title,
        body: dto.message,
        data: { broadcastId: broadcast.id },
      });
    }

    if (smsRequested) {
      for (const recipient of smsRecipients) {
        try {
          await this.sms.sendMessage(
            recipient.phoneNumber,
            `${dto.title}: ${dto.message}`,
          );
          smsSent += 1;
        } catch (error) {
          smsFailed += 1;
          // The full provider message is useful in the log but too noisy for the row.
          this.logger.warn(
            `Broadcast ${broadcast.id} SMS to ${recipient.id} failed: ${(error as Error).message}`,
          );
          if (failures.length < 3) {
            failures.push((error as Error).message);
          }
        }
      }
    }

    const attempted =
      (inAppRequested ? recipients.length : 0) +
      (smsRequested ? smsRecipients.length : 0);
    const delivered = inAppSent + smsSent;
    const status =
      delivered === 0
        ? BroadcastStatus.FAILED
        : delivered === attempted
          ? BroadcastStatus.SENT
          : BroadcastStatus.PARTIAL;

    const updated = await this.prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        status,
        smsSentCount: smsSent,
        smsFailedCount: smsFailed,
        inAppSentCount: inAppSent,
        error: failures.length > 0 ? failures.join(' | ').slice(0, 1000) : null,
        sentAt: new Date(),
      },
    });

    await this.audit.log({
      entityType: 'Broadcast',
      entityId: broadcast.id,
      action: 'BROADCAST_SENT',
      actorId: adminId,
      fromStatus: BroadcastStatus.SENDING,
      toStatus: status,
      metadata: {
        roles,
        channels,
        userCount: recipients.length,
        inAppSent,
        smsSent,
        smsFailed,
      },
    });

    return this.toResponse(updated);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async resolveRecipients(roles: BroadcastRole[]): Promise<Recipient[]> {
    // BroadcastRole deliberately omits ADMIN; mapping keeps the Prisma types honest
    // instead of casting the array.
    const userRoles = roles.map((role) => UserRole[role]);
    return this.prisma.user.findMany({
      where: { role: { in: userRoles }, status: UserStatus.ACTIVE },
      select: { id: true, phoneNumber: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async requireBroadcast(id: string): Promise<Broadcast> {
    const broadcast = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!broadcast) throw new NotFoundException('Broadcast not found.');
    return broadcast;
  }

  private toResponse(broadcast: Broadcast): BroadcastResponseDto {
    return {
      id: broadcast.id,
      title: broadcast.title,
      message: broadcast.message,
      audience: { roles: broadcast.roles, status: 'active' },
      channels: broadcast.channels,
      status: broadcast.status,
      mode: broadcast.mode,
      userCount: broadcast.userCount,
      smsRecipientCount: broadcast.smsRecipientCount,
      inAppRecipientCount: broadcast.inAppRecipientCount,
      smsSentCount: broadcast.smsSentCount,
      smsFailedCount: broadcast.smsFailedCount,
      inAppSentCount: broadcast.inAppSentCount,
      error: broadcast.error,
      sentAt: broadcast.sentAt,
      createdAt: broadcast.createdAt,
    };
  }
}
