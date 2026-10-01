import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { JobsModule } from './jobs/jobs.module';
import { WebSocketsModule } from './websockets/websockets.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { CatalogModule } from './catalog/catalog.module';
import { TechniciansModule } from './technicians/technicians.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
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
    HealthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
