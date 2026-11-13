import { Module } from '@nestjs/common';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';
import { RolesGuard } from '../auth/roles.guard';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';

// Cross-cutting administrator endpoints that are not owned by a single domain
// module, including platform statistics and dashboard analytics.
@Module({
  controllers: [AdminStatsController, AdminDashboardController],
  providers: [AdminStatsService, AdminDashboardService, RolesGuard],
})
export class AdminModule {}
