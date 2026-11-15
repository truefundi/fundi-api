import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth } from '../common/decorators/auth.decorator';
import { PagedQueryDto } from '../common/dto/paged-query.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Admin technician ratings')
@Controller('api/v1/admin/technicians/:technicianId/ratings')
@Auth(UserRole.ADMIN)
export class AdminTechnicianRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get()
  @ApiOperation({
    summary: 'List a technician’s ratings and aggregate scores',
  })
  list(
    @Param('technicianId', ParseUUIDPipe) technicianId: string,
    @Query() query: PagedQueryDto,
  ) {
    return this.ratings.listTechnicianRatings(technicianId, query, 'admin');
  }
}
