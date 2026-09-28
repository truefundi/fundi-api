import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Check health status of API, Database, and Redis' })
  @ApiResponse({ status: 200, description: 'Health status response' })
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

    const overallStatus = dbStatus === 'up' && redisStatus === 'up' ? 'ok' : 'degraded';

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      services: {
        api: 'up',
        database: dbStatus,
        redis: redisStatus,
      },
    };
  }
}
