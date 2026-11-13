import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { CreateJobRatingDto } from './dto/job-rating.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Job ratings')
@Controller('api/v1/jobs/mine/:jobId')
@Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
export class JobRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get('rating-items')
  @ApiOperation({
    summary: 'List rating items for a completed job owned by the caller',
  })
  listItems(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.ratings.listItemsForJob(user.id, jobId);
  }

  @Get('rating')
  @ApiOperation({ summary: 'Get the caller’s submitted job rating' })
  getRating(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.ratings.getJobRatingForOwner(user.id, jobId);
  }

  @Post('rating')
  @ApiOperation({
    summary: 'Rate the assigned technician for a completed job',
    description:
      'Optional: the job owner may submit one score from 1 to 5 for every active rating item. A submitted rating cannot be edited by the owner.',
  })
  submit(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: CreateJobRatingDto,
  ) {
    return this.ratings.submitJobRating(user.id, jobId, dto);
  }
}
