import {
  Controller,
  Get,
  Headers,
  MessageEvent,
  Query,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EMPTY, from, interval } from 'rxjs';
import { exhaustMap, map, mergeMap, startWith } from 'rxjs/operators';
import { StaffAuth, CurrentUser, AuthUser } from '../common/decorators/auth.decorator';
import { DASHBOARD_PERMISSIONS } from '../staff/permission-catalog';
import { PermissionsService } from '../staff/permissions.service';
import { PrismaService } from '../database/prisma.service';
import { AdminDashboardService } from './admin-dashboard.service';
import {
  DashboardActivityQueryDto,
  DashboardQueryDto,
  DashboardTrendsQueryDto,
  TopTechniciansQueryDto,
} from './dto/dashboard-query.dto';

@ApiTags('Admin dashboard analytics')
@Controller('api/v1/admin/dashboard')
@StaffAuth(...DASHBOARD_PERMISSIONS)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService,
    private readonly permissions: PermissionsService, private readonly prisma: PrismaService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Get dashboard summary cards across platform domains',
    description:
      'Results are cached per API process for 15 seconds after computation completes. Identical concurrent requests and shared aggregates coalesce pending work. Observed audit-stream activity invalidates the cache.',
  })
  overview(@Query() query: DashboardQueryDto) {
    return this.dashboard.overview(query);
  }

  @Get('trends')
  @ApiOperation({
    summary: 'Get time-series chart data across platform domains',
    description:
      'Returns sparse time buckets for signups, jobs, completions, booking amounts, disputes, chat messages, and ratings. Cached per query for up to 15 seconds.',
  })
  trends(@Query() query: DashboardTrendsQueryDto) {
    return this.dashboard.trends(query);
  }

  @Get('breakdowns')
  @ApiOperation({
    summary: 'Get dashboard chart breakdowns across platform domains',
    description: 'Cached per query for up to 15 seconds; shares matching aggregates with overview requests.',
  })
  breakdowns(@Query() query: DashboardQueryDto) {
    return this.dashboard.breakdowns(query);
  }

  @Get('top-technicians')
  @StaffAuth('dashboard.view', 'technicians.view', 'jobs.view', 'ratings.view')
  @ApiOperation({
    summary:
      'Rank technicians by completed jobs and ratings in the selected period',
    description: 'Cached per query for up to 15 seconds.',
  })
  topTechnicians(@Query() query: TopTechniciansQueryDto) {
    return this.dashboard.topTechnicians(query);
  }

  @Get('activity')
  @StaffAuth('dashboard.view', 'audit.view')
  @ApiOperation({
    summary: 'Get paginated audit activity for dashboard feeds',
  })
  activity(@Query() query: DashboardActivityQueryDto) {
    return this.dashboard.activity(query);
  }

  @Sse('events')
  @StaffAuth('dashboard.view', 'audit.view')
  @ApiOperation({
    summary: 'Stream new audit activity to the admin dashboard using SSE',
    description:
      'Send Last-Event-ID when reconnecting. The stream emits dashboard.activity events as audit rows are committed.',
  })
  events(@CurrentUser() user: AuthUser, @Headers('last-event-id') lastEventId?: string) {
    let cursor = this.dashboard.activityEvents(lastEventId);
    return interval(2_000).pipe(
      startWith(0),
      exhaustMap(() =>
        from(this.authorizedActivity(user, cursor)).pipe(
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

  private async authorizedActivity(user: AuthUser, cursor: ReturnType<AdminDashboardService['activityEvents']>) {
    if (!user.sessionId || !user.accessExpiresAt || user.accessExpiresAt * 1000 <= Date.now()) throw new UnauthorizedException('Session expired.');
    const session = await this.prisma.refreshToken.findUnique({ where: { sessionId: user.sessionId } });
    if (!session || session.userId !== user.id || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Session revoked.');
    await this.permissions.require(user.id, ['dashboard.view', 'audit.view']);
    return this.dashboard.activityAfter(cursor);
  }
}
