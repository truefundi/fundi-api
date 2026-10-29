import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { JobSummaryResponseDto } from './dto/job-summary-response.dto';
import { AdminCancelJobDto } from './dto/admin-cancel-job.dto';
import { AdminCreateJobDto } from './dto/admin-create-job.dto';
import { AdminReassignJobDto } from './dto/admin-reassign-job.dto';
import { AdminRateJobDto } from './dto/admin-rate-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
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
      'Counts active (OPEN or ASSIGNED) and COMPLETED jobs, plus disputes that ' +
      'have no resolution yet.',
  })
  @ApiResponse({
    status: 200,
    description: 'Job counts for the admin dashboard',
    type: JobSummaryResponseDto,
  })
  summary() {
    return this.jobs.summaryForAdmin();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a job for a customer (admin only)',
    description:
      'Creates the request on an active customer’s behalf. The job is dispatched ' +
      'like a customer request: matching technicians receive offers immediately.',
  })
  @ApiResponse({ status: 201, description: 'The created job' })
  create(@CurrentUser() user: AuthUser, @Body() dto: AdminCreateJobDto) {
    return this.jobs.createForAdmin(dto, user.id);
  }

  @Get(':jobId')
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.jobs.getForAdmin(jobId);
  }

  @Patch(':jobId')
  @ApiOperation({
    summary: 'Edit a job (admin only)',
    description:
      'An unassigned OPEN job is re-matched after the change. Once a technician ' +
      'is assigned the job stays with them and its fields are corrected in place.',
  })
  @ApiResponse({ status: 200, description: 'The updated job' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobs.adminUpdate(jobId, dto, user.id);
  }

  @Post(':jobId/cancel')
  @ApiOperation({
    summary: 'Cancel a job (admin only)',
    description:
      'Cancels an OPEN or ASSIGNED job, withdraws pending offers, closes the ' +
      'assignment, and declines any open negotiation with the reason kept on the job.',
  })
  @ApiResponse({ status: 201, description: 'The cancelled job' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: AdminCancelJobDto,
  ) {
    return this.jobs.adminCancel(jobId, dto.reason, user.id);
  }

  @Post(':jobId/reassign')
  @ApiOperation({
    summary: 'Reassign a job to another technician (admin only)',
    description:
      'Moves an OPEN or ASSIGNED job to an approved, active technician. The ' +
      'previous assignment ends, pending offers are withdrawn, and progress restarts.',
  })
  @ApiResponse({ status: 201, description: 'The reassigned job' })
  reassign(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: AdminReassignJobDto,
  ) {
    return this.jobs.adminReassign(jobId, dto.technicianId, user.id);
  }

  @Post(':jobId/rating')
  @ApiOperation({
    summary: 'Rate a job (admin only)',
    description:
      'Records the customer’s post-job rating on their behalf. All six categories ' +
      'are whole stars from 1 to 5; `overall` is the average shown in the dashboard.',
  })
  @ApiResponse({ status: 201, description: 'The rated job' })
  rate(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: AdminRateJobDto,
  ) {
    return this.jobs.adminRate(jobId, dto, user.id);
  }

  @Delete(':jobId')
  @ApiOperation({
    summary: 'Delete an open or cancelled job (admin only)',
    description:
      'Removes a mistaken or duplicate job and its stored media. Assigned and ' +
      'completed jobs must be cancelled instead so their record stays traceable.',
  })
  @ApiResponse({ status: 200, description: 'Job deleted' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.adminDelete(jobId, user.id);
  }
}
