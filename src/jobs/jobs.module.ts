import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { WebSocketsModule } from '../websockets/websockets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { parseRedisOptions } from '../redis/redis-options';
import { AdminJobsController } from './admin-jobs.controller';
import { JobDispatchProcessor } from './job-dispatch.processor';
import { JobMediaController } from './job-media.controller';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { TechnicianJobsController } from './technician-jobs.controller';
import { TestQueueProcessor } from './test-queue.processor';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    GeocodingModule,
    StorageModule,
    AuditModule,
    WebSocketsModule,
    NotificationsModule,
    AuthModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          ...parseRedisOptions(configService),
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'test-queue',
    }),
    BullModule.registerQueue({
      name: 'job-dispatch',
    }),
  ],
  controllers: [
    JobsController,
    TechnicianJobsController,
    AdminJobsController,
    JobMediaController,
  ],
  providers: [TestQueueProcessor, JobDispatchProcessor, JobsService],
  exports: [BullModule, JobsService],
})
export class JobsModule {}
