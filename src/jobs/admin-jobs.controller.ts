import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { JobSummaryResponseDto } from './dto/job-summary-response.dto';
import { JobsService } from './jobs.service';
import { AdminUpdateJobDto } from './dto/admin-update-job.dto';
import { ReviewCancellationDto } from './dto/cancel-job.dto';

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

  @Get('cancellation-requests')
  listCancellationRequests() {
    return this.jobs.listCancellationRequests();
  }

  @Patch('cancellation-requests/:requestId')
  reviewCancellation(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ReviewCancellationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.reviewCancellation(requestId, dto, user.id);
  }

  @Get(':jobId')
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.jobs.getForAdmin(jobId);
  }

  @Patch(':jobId')
  update(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: AdminUpdateJobDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.updateByAdmin(jobId, dto, user.id);
  }

  @Delete(':jobId')
  delete(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.jobs.permanentlyDelete(jobId, user.id);
  }
}
