import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth } from '../common/decorators/auth.decorator';
import { JobSummaryResponseDto } from './dto/job-summary-response.dto';
import { JobsService } from './jobs.service';

@ApiTags('Admin jobs')
@Controller('api/v1/admin/jobs')
@Auth(UserRole.ADMIN)
export class AdminJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list() {
    return this.jobs.listForAdmin();
  }

  // Declared before ':jobId' so the literal segment is not parsed as a UUID.
  @Get('summary')
  @ApiOperation({
    summary: 'Get dashboard job counts (admin only)',
    description:
      'Counts active (OPEN or ASSIGNED) and COMPLETED jobs. `openDisputes` is null until ' +
      'the disputes feature is implemented, which tells the dashboard to show a placeholder.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job counts for the admin dashboard',
    type: JobSummaryResponseDto,
  })
  summary() {
    return this.jobs.summaryForAdmin();
  }

  @Get(':jobId')
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.jobs.getForAdmin(jobId);
  }
}
