import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Controller('api/v1/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Public: used by the onboarding wizard and the customer "request a technician" screen. */
  @Get('categories')
  list() {
    return this.catalog.listActive();
  }

  // Public: returns active category matches for a customer or technician search.
  @Get('categories/search')
  search(@Query('name') name: string) {
    if (!name?.trim())
      throw new BadRequestException('The name query parameter is required.');
    return this.catalog.searchActive(name);
  }

  // Public: returns one category only when it is currently available.
  @Get('categories/:id')
  getActiveById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getActiveById(id);
  }

  // Admin: lists active and inactive categories for management.
  @Get('admin/categories')
  @Auth(UserRole.ADMIN)
  listAll() {
    return this.catalog.listAll();
  }

  // Admin: exact case-insensitive name lookup, including inactive categories.
  @Get('admin/categories/by-name')
  @Auth(UserRole.ADMIN)
  getByName(@Query('name') name: string) {
    if (!name?.trim())
      throw new BadRequestException('The name query parameter is required.');
    return this.catalog.getByName(name);
  }

  // Admin: retrieves a category by ID, including inactive records.
  @Get('admin/categories/:id')
  @Auth(UserRole.ADMIN)
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getById(id);
  }

  // Admin: creates a category and records the change in the audit log.
  @Post('categories')
  @Auth(UserRole.ADMIN)
  create(@Body() dto: CreateCategoryDto, @CurrentUser() user: AuthUser) {
    return this.catalog.create(dto, user.id);
  }

  // Admin: edits a category's name or availability.
  @Patch('categories/:id')
  @Auth(UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.update(id, dto, user.id);
  }

  // Admin: soft-deletes a category so existing technician assignments remain valid.
  @Delete('categories/:id')
  @Auth(UserRole.ADMIN)
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.deactivate(id, user.id);
  }
}
