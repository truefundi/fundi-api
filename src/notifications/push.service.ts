import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;
const EXPO_BATCH_SIZE = 100;

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

/**
 * Mirrors in-app notifications to the user's devices through Expo's push
 * service, so a technician hears about a request while the app is closed.
 * Delivery is best effort: failures are logged and never thrown, and tokens
 * Expo reports as unregistered are removed.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  static isValidToken(token: string): boolean {
    return EXPO_TOKEN_PATTERN.test(token);
  }

  async register(userId: string, token: string, platform?: string | null) {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform: platform ?? null },
      update: { userId, platform: platform ?? null },
    });
    return { registered: true };
  }

  async unregister(userId: string, token: string) {
    const result = await this.prisma.pushToken.deleteMany({
      where: { userId, token },
    });
    return { removed: result.count };
  }

  async sendToUser(userId: string, message: PushMessage): Promise<void> {
    try {
      const tokens = await this.prisma.pushToken.findMany({
        where: { userId },
        select: { token: true },
      });
      if (!tokens.length) return;
      await this.send(
        tokens.map(({ token }) => token),
        message,
      );
    } catch (error) {
      this.logger.warn(
        `Push delivery to user ${userId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async send(tokens: string[], message: PushMessage): Promise<void> {
    for (let index = 0; index < tokens.length; index += EXPO_BATCH_SIZE) {
      const batch = tokens.slice(index, index + EXPO_BATCH_SIZE);
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          batch.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: 'default',
            priority: 'high',
            channelId: 'default',
          })),
        ),
      });
      if (!response.ok) {
        this.logger.warn(`Expo push request failed with ${response.status}.`);
        continue;
      }
      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const stale = (payload.data ?? [])
        .map((ticket, position) =>
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered'
            ? batch[position]
            : null,
        )
        .filter((token): token is string => Boolean(token));
      if (stale.length) {
        await this.prisma.pushToken.deleteMany({
          where: { token: { in: stale } },
        });
      }
    }
  }
}
