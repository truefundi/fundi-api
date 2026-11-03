import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../database/prisma.service';
import { ChatService } from './chat.service';
import {
  ChatRealtimeService,
  chatSocketRoom,
  chatUserSocketRoom,
} from './chat-realtime.service';

interface ChatSocketIdentity {
  userId: string;
  role: UserRole;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: '*' },
})
export class ChatGateway
  implements
    OnGatewayInit<Namespace>,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Namespace;

  private readonly logger = new Logger(ChatGateway.name);
  private publisher?: Redis;
  private subscriber?: Redis;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  async afterInit(namespace: Namespace) {
    this.publisher = this.createRedisClient();
    this.subscriber = this.publisher.duplicate();
    await Promise.all([
      this.connectRedis(this.publisher),
      this.connectRedis(this.subscriber),
    ]);
    namespace.server.adapter(createAdapter(this.publisher, this.subscriber));
    this.realtime.bind(namespace);
    this.logger.log(
      'Chat websocket namespace is ready with the Redis adapter.',
    );
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.accessToken ??
        this.bearerToken(client.handshake.headers.authorization);
      if (typeof token !== 'string' || !token) {
        client.disconnect(true);
        return;
      }
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        sid: string;
      }>(token, {
        secret:
          this.config.get<string>('jwt.accessSecret') ||
          'default_dev_access_secret_32chars',
      });
      if (!payload.sub || !payload.sid) {
        client.disconnect(true);
        return;
      }
      const session = await this.prisma.refreshToken.findUnique({
        where: { sessionId: payload.sid },
        select: { userId: true, expiresAt: true },
      });
      if (
        !session ||
        session.userId !== payload.sub ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        client.disconnect(true);
        return;
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true },
      });
      if (!user || user.status !== 'ACTIVE') {
        client.disconnect(true);
        return;
      }
      client.data.identity = {
        userId: user.id,
        role: user.role,
      } satisfies ChatSocketIdentity;
      await client.join(chatUserSocketRoom(user.id));
    } catch (error) {
      this.logger.debug(
        `Rejected unauthenticated chat socket: ${this.errorMessage(error)}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const identity = this.identity(client);
    if (identity) {
      this.logger.debug(
        `Chat socket disconnected for account ${identity.userId}.`,
      );
    }
  }

  @SubscribeMessage('chat:join')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId?: string },
  ) {
    return this.withSocketErrors(async () => {
      const identity = this.requireIdentity(client);
      const roomId = this.requiredRoomId(body?.roomId);
      await this.chat.authorizeSocketRoom(
        identity.userId,
        identity.role,
        roomId,
      );
      await client.join(chatSocketRoom(roomId));
      return { roomId, joined: true };
    });
  }

  @SubscribeMessage('chat:leave')
  async leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId?: string },
  ) {
    const identity = this.requireIdentity(client);
    const roomId = this.requiredRoomId(body?.roomId);
    await this.chat.authorizeSocketRoom(identity.userId, identity.role, roomId);
    await client.leave(chatSocketRoom(roomId));
    return { roomId, left: true };
  }

  @SubscribeMessage('chat:message:send')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId?: string; text?: string },
  ) {
    return this.withSocketErrors(async () => {
      const identity = this.requireIdentity(client);
      const roomId = this.requiredRoomId(body?.roomId);
      if (typeof body?.text !== 'string') {
        throw new WsException('A text message is required.');
      }
      return this.chat.postText(
        identity.userId,
        identity.role,
        roomId,
        body.text,
      );
    });
  }

  @SubscribeMessage('chat:message:read')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId?: string; messageId?: string },
  ) {
    return this.withSocketErrors(async () => {
      const identity = this.requireIdentity(client);
      const roomId = this.requiredRoomId(body?.roomId);
      if (typeof body?.messageId !== 'string') {
        throw new WsException('A messageId is required.');
      }
      return this.chat.markRead(
        identity.userId,
        identity.role,
        roomId,
        body.messageId,
      );
    });
  }

  @SubscribeMessage('chat:typing')
  async typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { roomId?: string; active?: boolean },
  ) {
    return this.withSocketErrors(async () => {
      const identity = this.requireIdentity(client);
      const roomId = this.requiredRoomId(body?.roomId);
      await this.chat.authorizeSocketRoom(
        identity.userId,
        identity.role,
        roomId,
        true,
      );
      this.realtime.publish(
        roomId,
        'chat:typing',
        { userId: identity.userId, active: body.active === true },
        client.id,
      );
      return { roomId, active: body.active === true };
    });
  }

  async onModuleDestroy() {
    await Promise.all([
      this.quitRedis(this.publisher),
      this.quitRedis(this.subscriber),
    ]);
  }

  private async withSocketErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof WsException) throw error;
      const message =
        error instanceof Error ? error.message : 'Chat socket request failed.';
      throw new WsException(message);
    }
  }

  private identity(client: Socket): ChatSocketIdentity | null {
    const identity = client.data.identity as ChatSocketIdentity | undefined;
    return identity ?? null;
  }

  private requireIdentity(client: Socket): ChatSocketIdentity {
    const identity = this.identity(client);
    if (!identity) throw new WsException('Authenticate before using chat.');
    return identity;
  }

  private requiredRoomId(roomId?: string): string {
    if (
      typeof roomId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        roomId,
      )
    ) {
      throw new WsException('A valid roomId is required.');
    }
    return roomId;
  }

  private bearerToken(authorization?: string) {
    return /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
  }

  private createRedisClient(): Redis {
    const host = this.config.get<string>('redis.host', 'localhost');
    const port = this.config.get<number>('redis.port', 6379);
    return new Redis({
      host,
      port,
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
  }

  private async connectRedis(client: Redis) {
    if (client.status === 'wait') await client.connect();
    if (client.status !== 'ready') {
      throw new Error('Redis is unavailable for chat websocket distribution.');
    }
  }

  private async quitRedis(client?: Redis) {
    if (!client || client.status === 'end') return;
    await client.quit();
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
