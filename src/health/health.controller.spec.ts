import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrismaService: { $queryRaw: jest.Mock };
  let mockRedisService: { ping: jest.Mock };

  beforeEach(async () => {
    mockPrismaService = {
      $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
    };
    mockRedisService = {
      ping: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return overall status ok when dependencies are up', async () => {
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.services.api).toBe('up');
    expect(result.services.database).toBe('up');
    expect(result.services.redis).toBe('up');
  });

  it('should throw 503 ServiceUnavailableException when PostgreSQL is down', async () => {
    mockPrismaService.$queryRaw.mockRejectedValueOnce(new Error('db offline'));
    await expect(controller.check()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('should throw 503 ServiceUnavailableException when Redis is down', async () => {
    mockRedisService.ping.mockResolvedValueOnce(false);
    await expect(controller.check()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
