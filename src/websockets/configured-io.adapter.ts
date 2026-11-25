import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/** All namespaces share one transport, including cookie-authenticated admin sessions. */
export class ConfiguredIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const origins = this.config.get<string[]>('cors.origins', [
      'http://localhost:3000',
      'http://localhost:8081',
    ]);
    return super.createIOServer(port, {
      ...options,
      cors: { origin: origins, credentials: true },
      // CORS alone does not protect the WebSocket transport's cookie handshake.
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        callback(null, !origin || origins.includes(origin));
      },
    } satisfies Partial<ServerOptions>);
  }
}
