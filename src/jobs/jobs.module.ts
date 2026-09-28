import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { TestQueueProcessor } from './test-queue.processor';

@Module({
  imports: [
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
  ],
  providers: [TestQueueProcessor],
  exports: [BullModule],
})
export class JobsModule {}
