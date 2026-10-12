import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth } from '../common/decorators/auth.decorator';
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

  @Get(':jobId')
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.jobs.getForAdmin(jobId);
  }
}
