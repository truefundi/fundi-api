import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    const environment = process.env.NODE_ENV || 'development';
    if (!process.env.DATABASE_URL?.trim()) {
      throw new Error('DATABASE_URL is required before connecting to PostgreSQL.');
    }
    try {
      await this.$connect();
      this.logger.log('Prisma connected to PostgreSQL database successfully.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (environment !== 'development') {
        this.logger.error(
          `Fatal database connection failure in ${environment}: ${message}`,
        );
        throw err;
      }
      this.logger.warn(
        `Database connection alert: ${message}. Verify DATABASE_URL in backend/.env.`,
      );
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
