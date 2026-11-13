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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import {
  CreateRatingItemDto,
  UpdateRatingItemDto,
} from './dto/rating-item.dto';
import { RatingsService } from './ratings.service';

@ApiTags('Admin rating items')
@Controller('api/v1/admin/rating-items')
@Auth(UserRole.ADMIN)
export class RatingItemsAdminController {
  constructor(private readonly ratings: RatingsService) {}

  @Get()
  @ApiOperation({ summary: 'List rating items, including archived items' })
  list() {
    return this.ratings.listRatingItems();
  }

  @Get(':itemId')
  @ApiOperation({ summary: 'Get a rating item by ID' })
  get(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.ratings.getRatingItem(itemId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a rating item' })
  create(@Body() dto: CreateRatingItemDto, @CurrentUser() user: AuthUser) {
    return this.ratings.createRatingItem(dto, user.id);
  }

  @Patch(':itemId')
  @ApiOperation({ summary: 'Update or reactivate a rating item' })
  update(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateRatingItemDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ratings.updateRatingItem(itemId, dto, user.id);
  }

  @Delete(':itemId')
  @ApiOperation({ summary: 'Archive a rating item without deleting history' })
  archive(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ratings.archiveRatingItem(itemId, user.id);
  }
}
