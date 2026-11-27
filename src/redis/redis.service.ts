import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { parseRedisOptions } from './redis-options';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private configService: ConfigService) {
    const options = parseRedisOptions(this.configService);

    this.client = new Redis({
      ...options,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis connection warning/error: ${err.message}`);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status !== 'ready') {
        await this.client.connect();
      }
      const response = await this.client.ping();
      return response === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.client.status === 'end' || this.client.status === 'wait') {
      this.client.disconnect();
      return;
    }
    await this.client.quit();
  }
}
