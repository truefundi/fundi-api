import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PagedQueryDto } from '../common/dto/paged-query.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Public technicians')
@Controller('api/v1/public/technicians/:id/reviews')
export class PublicTechnicianReviewsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get()
  @ApiOperation({
    summary: "An approved technician's customer reviews",
    description:
      'Newest first, with the average score and count. Reviewers are shown by first name and initial.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  list(@Param('id', ParseUUIDPipe) id: string, @Query() query: PagedQueryDto) {
    return this.ratings.listPublicTechnicianReviews(id, query);
  }
}
