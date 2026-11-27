import { Module } from '@nestjs/common';
import { RolesGuard } from '../auth/roles.guard';
import { StorageModule } from '../storage/storage.module';
import { AdminAdsController } from './admin-ads.controller';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';

// Public promotion cards plus the dashboard management routes.
@Module({
  imports: [StorageModule],
  controllers: [AdsController, AdminAdsController],
  providers: [AdsService, RolesGuard],
})
export class AdsModule {}
