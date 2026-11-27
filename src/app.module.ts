import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';
import {
  ProxyAwareThrottlerGuard,
  RedisThrottlerStorage,
} from './common/throttler/redis-throttler.storage';
import { JobsModule } from './jobs/jobs.module';
import { WebSocketsModule } from './websockets/websockets.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { CatalogModule } from './catalog/catalog.module';
import { TechniciansModule } from './technicians/technicians.module';
import { AdminModule } from './admin/admin.module';
import { ConversationsModule } from './conversations/conversations.module';
import { PaymentsModule } from './payments/payments.module';
import { DisputesModule } from './disputes/disputes.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ChatModule } from './chat/chat.module';
import { AdsModule } from './ads/ads.module';
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { RatingsModule } from './ratings/ratings.module';
import { CompaniesModule } from './companies/companies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: 120,
          },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
    DatabaseModule,
    RedisModule,
    JobsModule,
    WebSocketsModule,
    AuthModule,
    UsersModule,
    AuditModule,
    CatalogModule,
    TechniciansModule,
    AdminModule,
    ConversationsModule,
    PaymentsModule,
    DisputesModule,
    NotificationsModule,
    ChatModule,
    AdsModule,
    BroadcastsModule,
    RatingsModule,
    CompaniesModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ProxyAwareThrottlerGuard,
    },
  ],
})
export class AppModule {}
