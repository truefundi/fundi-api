import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@SkipThrottle()
@Controller('api/v1/health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check health status of API, Database, and Redis' })
  @ApiResponse({ status: 200, description: 'All backing services are healthy' })
  @ApiResponse({
    status: 503,
    description: 'Database or Redis is unreachable',
  })
  async check() {
    let dbStatus = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }

    let redisStatus = 'down';
    try {
      const isRedisOk = await this.redisService.ping();
      redisStatus = isRedisOk ? 'up' : 'down';
    } catch {
      redisStatus = 'down';
    }

    const healthy = dbStatus === 'up' && redisStatus === 'up';
    const payload = {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        api: 'up',
        database: dbStatus,
        redis: redisStatus,
      },
    };

    if (!healthy) {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }
}
