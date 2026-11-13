import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { AdminJobRatingsController } from './admin-job-ratings.controller';
import { AdminTechnicianRatingsController } from './admin-technician-ratings.controller';
import { JobRatingsController } from './job-ratings.controller';
import { RatingItemsAdminController } from './rating-items-admin.controller';
import { RatingsService } from './ratings.service';
import { TechnicianRatingsController } from './technician-ratings.controller';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule],
  controllers: [
    RatingItemsAdminController,
    JobRatingsController,
    AdminJobRatingsController,
    AdminTechnicianRatingsController,
    TechnicianRatingsController,
  ],
  providers: [RatingsService],
})
export class RatingsModule {}
