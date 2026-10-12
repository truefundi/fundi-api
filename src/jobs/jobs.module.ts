import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { WebSocketsModule } from '../websockets/websockets.module';
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
    StorageModule,
    AuditModule,
    WebSocketsModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host', 'localhost'),
          port: configService.get<number>('redis.port', 6379),
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
  exports: [BullModule],
})
export class JobsModule {}
