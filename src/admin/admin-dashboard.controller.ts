import {
  Controller,
  Get,
  Headers,
  MessageEvent,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EMPTY, from, interval } from 'rxjs';
import { exhaustMap, map, mergeMap, startWith } from 'rxjs/operators';
import { Auth } from '../common/decorators/auth.decorator';
import { AdminDashboardService } from './admin-dashboard.service';
import {
  DashboardActivityQueryDto,
  DashboardQueryDto,
  DashboardTrendsQueryDto,
  TopTechniciansQueryDto,
} from './dto/dashboard-query.dto';

@ApiTags('Admin dashboard analytics')
@Controller('api/v1/admin/dashboard')
@Auth(UserRole.ADMIN)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get dashboard summary cards across platform domains',
  })
  overview(@Query() query: DashboardQueryDto) {
    return this.dashboard.overview(query);
  }

  @Get('trends')
  @ApiOperation({
    summary: 'Get time-series chart data across platform domains',
    description:
      'Returns sparse time buckets for signups, jobs, completions, booking amounts, disputes, chat messages, and ratings.',
  })
  trends(@Query() query: DashboardTrendsQueryDto) {
    return this.dashboard.trends(query);
  }

  @Get('breakdowns')
  @ApiOperation({
    summary: 'Get dashboard chart breakdowns across platform domains',
  })
  breakdowns(@Query() query: DashboardQueryDto) {
    return this.dashboard.breakdowns(query);
  }

  @Get('top-technicians')
  @ApiOperation({
    summary:
      'Rank technicians by completed jobs and ratings in the selected period',
  })
  topTechnicians(@Query() query: TopTechniciansQueryDto) {
    return this.dashboard.topTechnicians(query);
  }

  @Get('activity')
  @ApiOperation({
    summary: 'Get paginated audit activity for dashboard feeds',
  })
  activity(@Query() query: DashboardActivityQueryDto) {
    return this.dashboard.activity(query);
  }

  @Sse('events')
  @ApiOperation({
    summary: 'Stream new audit activity to the admin dashboard using SSE',
    description:
      'Send Last-Event-ID when reconnecting. The stream emits dashboard.activity events as audit rows are committed.',
  })
  events(@Headers('last-event-id') lastEventId?: string) {
    let cursor = this.dashboard.activityEvents(lastEventId);
    return interval(2_000).pipe(
      startWith(0),
      exhaustMap(() =>
        from(this.dashboard.activityAfter(cursor)).pipe(
          mergeMap((rows) => (rows.length ? from(rows) : EMPTY)),
          map((row) => {
            cursor = { createdAt: row.createdAt, id: row.id };
            const id = Buffer.from(
              JSON.stringify({
                createdAt: row.createdAt.toISOString(),
                id: row.id,
              }),
            ).toString('base64url');
            return {
              id,
              type: 'dashboard.activity',
              data: row,
            } satisfies MessageEvent;
          }),
        ),
      ),
    );
  }
}
