import { Injectable, Logger } from '@nestjs/common';
import { Namespace } from 'socket.io';

/** Namespace adapters distribute these disconnects across API instances. Cookies remain valid. */
@Injectable()
export class StaffAccessEventsService {
  private readonly namespaces = new Map<
    string,
    { namespace: Namespace; room: (id: string) => string }
  >();
  private readonly logger = new Logger(StaffAccessEventsService.name);

  bind(namespace: Namespace, room: (id: string) => string) {
    this.namespaces.set(namespace.name, { namespace, room });
  }

  invalidate(userId: string) {
    for (const { namespace, room } of this.namespaces.values()) {
      try {
        namespace.to(room(userId)).emit('staff:access-changed', { userId });
        namespace.in(room(userId)).disconnectSockets(true);
      } catch (error) {
        this.logger.error(
          `Could not invalidate staff sockets for ${userId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }
}
