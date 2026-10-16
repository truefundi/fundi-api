import { Module } from '@nestjs/common';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';
import { RolesGuard } from '../auth/roles.guard';

// Cross-cutting administrator endpoints that are not owned by a single domain
// module. Currently the dashboard statistics.
@Module({
  controllers: [AdminStatsController],
  providers: [AdminStatsService, RolesGuard],
})
export class AdminModule {}
