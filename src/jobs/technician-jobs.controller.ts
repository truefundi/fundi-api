import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import {
  DropJobDto,
  JobProgressDto,
  RejectJobOfferDto,
} from './dto/job-action.dto';
import { JobsService } from './jobs.service';

@ApiTags('Technician jobs')
@Controller('api/v1/jobs/technician')
@Auth(UserRole.TECHNICIAN)
export class TechnicianJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('offers')
  listOffers(@CurrentUser() user: AuthUser) {
    return this.jobs.listTechnicianOffers(user.id);
  }

  @Post('offers/:offerId/accept')
  acceptOffer(
    @CurrentUser() user: AuthUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.jobs.acceptOffer(user.id, offerId);
  }

  @Post('offers/:offerId/reject')
  rejectOffer(
    @CurrentUser() user: AuthUser,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() dto: RejectJobOfferDto,
  ) {
    return this.jobs.rejectOffer(user.id, offerId, dto);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.jobs.listTechnicianJobs(user.id);
  }

  @Get('mine/:jobId')
  getMine(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.getTechnicianJob(user.id, jobId);
  }

  @Patch('mine/:jobId/progress')
  updateProgress(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: JobProgressDto,
  ) {
    return this.jobs.updateProgress(user.id, jobId, 'technician', dto);
  }

  @Post('mine/:jobId/drop')
  drop(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: DropJobDto,
  ) {
    return this.jobs.dropJob(user.id, jobId, dto);
  }
}
