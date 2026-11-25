import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Server } from 'socket.io';
import * as request from 'supertest';
import { ConfiguredIoAdapter } from './configured-io.adapter';

describe('Cookie-capable Socket.IO transport', () => {
  let app: INestApplication;
  let server: Server;

  beforeEach(async () => {
    const module = await Test.createTestingModule({}).compile();
    app = module.createNestApplication();
    await app.init();
    const config = {
      get: jest.fn().mockReturnValue(['https://dashboard.fundi.test']),
    };
    const adapter = new ConfiguredIoAdapter(
      app,
      config as unknown as ConfigService,
    );
    server = adapter.createIOServer(0);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  });

  it('allows credentialed dashboard handshakes from a configured origin', async () => {
    const response = await request(app.getHttpServer())
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', 'https://dashboard.fundi.test')
      .set('Cookie', 'fundi_admin_access=test-token')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://dashboard.fundi.test',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an untrusted browser origin even if it supplies an admin cookie', async () => {
    await request(app.getHttpServer())
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', 'https://untrusted.test')
      .set('Cookie', 'fundi_admin_access=test-token')
      .expect(403);
  });

  it('continues to support native mobile handshakes without an Origin header', async () => {
    await request(app.getHttpServer())
      .get('/socket.io/?EIO=4&transport=polling')
      .expect(200);
  });
});
