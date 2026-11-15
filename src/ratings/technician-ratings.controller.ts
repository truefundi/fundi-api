import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { PagedQueryDto } from '../common/dto/paged-query.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Technician ratings')
@Controller('api/v1/technicians/profile/ratings')
@Auth(UserRole.TECHNICIAN)
export class TechnicianRatingsController {
  constructor(private readonly ratings: RatingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get my ratings and aggregate scores' })
  list(@CurrentUser() user: AuthUser, @Query() query: PagedQueryDto) {
    return this.ratings.listMyTechnicianRatings(user.id, query);
  }
}
