import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/events',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    const token =
      client.handshake.auth?.accessToken ??
      this.bearerToken(client.handshake.headers.authorization);
    if (typeof token !== 'string' || !token) return;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string; typ?: string }>(
        token,
        {
          secret:
            this.config.get<string>('jwt.accessSecret') ||
            'default_dev_access_secret_32chars',
        },
      );
      // Only access tokens are accepted here, never a refresh token presented as one.
      if (!payload.sub || !payload.sid || payload.typ !== 'access') return;
      const session = await this.prisma.refreshToken.findUnique({
        where: { sessionId: payload.sid },
        select: { userId: true, expiresAt: true },
      });
      if (
        !session ||
        session.userId !== payload.sub ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        return;
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, role: true, status: true },
      });
      if (!user || user.status !== 'ACTIVE') {
        return;
      }
      await client.join(this.userRoom(user.id));
      if (user.role === 'TECHNICIAN') {
        await client.join(this.technicianRoom(user.id));
      }
    } catch (error) {
      this.logger.debug(
        `Socket client ${client.id} did not authenticate for job events: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('ping')
  handlePing(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: any,
  ): string {
    this.logger.log(`Ping received from ${client.id}: ${JSON.stringify(data)}`);
    return 'pong';
  }

  notifyTechnician(userId: string, event: string, data: unknown) {
    if (!this.server) {
      this.logger.warn(
        `Cannot emit ${event}; Socket.IO server is not initialized.`,
      );
      return;
    }
    this.server.to(this.technicianRoom(userId)).emit(event, data);
  }

  notifyUser(userId: string, event: string, data: unknown) {
    if (!this.server) {
      this.logger.warn(
        `Cannot emit ${event}; Socket.IO server is not initialized.`,
      );
      return;
    }
    this.server.to(this.userRoom(userId)).emit(event, data);
  }

  private technicianRoom(userId: string) {
    return `technician:${userId}`;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private bearerToken(authorization?: string) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    return match?.[1];
  }
}
