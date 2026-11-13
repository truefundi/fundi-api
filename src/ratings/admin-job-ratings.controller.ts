import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { CreateJobRatingDto, UpdateJobRatingDto } from './dto/job-rating.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Admin job ratings')
@Controller('api/v1/admin/jobs/:jobId/ratings')
@Auth(UserRole.ADMIN)
export class AdminJobRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get a job’s dynamic rating' })
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.ratings.getJobRatingForAdmin(jobId);
  }

  @Post()
  @ApiOperation({
    summary: 'Submit a dynamic rating for a customer on their behalf',
  })
  create(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: CreateJobRatingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ratings.submitJobRatingAsAdmin(jobId, dto, user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Correct a dynamic job rating' })
  update(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: UpdateJobRatingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ratings.updateJobRatingAsAdmin(jobId, dto, user.id);
  }
}
