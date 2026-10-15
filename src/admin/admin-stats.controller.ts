import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth } from '../common/decorators/auth.decorator';
import { AdminStatsService } from './admin-stats.service';
import { AdminStatsResponseDto } from './dto/admin-stats-response.dto';

@ApiTags('Admin dashboard')
@Controller('api/v1/admin')
@Auth(UserRole.ADMIN)
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  // Returns the platform-wide account counts for the admin dashboard.
  @Get('stats')
  @ApiOperation({
    summary: 'Get platform statistics (admin only)',
    description:
      'Counts customers, technicians, technicians awaiting verification, and blocked accounts. ' +
      'Customers and technicians are counted from the account role; administrators are excluded.',
  })
  @ApiResponse({
    status: 200,
    description: 'Platform account statistics',
    type: AdminStatsResponseDto,
  })
  getStats() {
    return this.stats.getStats();
  }
}
