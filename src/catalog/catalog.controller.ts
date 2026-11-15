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
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';

@ApiTags('Catalog')
@Controller('api/v1/catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  listCategories() {
    return this.catalog.listCategories();
  }

  @Get('categories/search')
  searchCategories(@Query('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('The name query parameter is required.');
    }
    return this.catalog.searchCategories(name);
  }

  @Get('categories/:id')
  getActiveCategoryById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getActiveCategoryById(id);
  }

  @Get('admin/categories')
  @Auth(UserRole.ADMIN)
  listAllCategories() {
    return this.catalog.listAllCategories();
  }

  @Get('admin/categories/by-name')
  @Auth(UserRole.ADMIN)
  getCategoryByName(@Query('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('The name query parameter is required.');
    }
    return this.catalog.getCategoryByName(name);
  }

  @Get('admin/categories/:id')
  @Auth(UserRole.ADMIN)
  getCategoryById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getCategoryById(id);
  }

  @Post('categories')
  @Auth(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a parent category (admin only)' })
  @ApiBody({
    type: CreateCategoryDto,
    examples: {
      default: {
        summary: 'Create category',
        value: {
          name: 'Home Services',
          description: 'Repairs and maintenance for homes.',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The created parent category',
    schema: {
      example: {
        id: '84cfa9af-05d4-40c1-ad36-123e412ec509',
        name: 'Home Services',
        description: 'Repairs and maintenance for homes.',
        isActive: true,
        createdAt: '2026-11-13T09:00:00.000Z',
        updatedAt: '2026-11-13T09:00:00.000Z',
      },
    },
  })
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createCategory(dto, user.id);
  }

  @Patch('categories/:id')
  @Auth(UserRole.ADMIN)
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateCategory(id, dto, user.id);
  }

  @Delete('categories/:id')
  @Auth(UserRole.ADMIN)
  deactivateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.deactivateCategory(id, user.id);
  }

  @Get('services')
  listActiveServices() {
    return this.catalog.listActiveServices();
  }

  @Get('services/search')
  searchActiveServices(@Query('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('The name query parameter is required.');
    }
    return this.catalog.searchActiveServices(name);
  }

  @Get('services/:id')
  getActiveServiceById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getActiveServiceById(id);
  }

  @Get('admin/services')
  @Auth(UserRole.ADMIN)
  listAllServices() {
    return this.catalog.listAllServices();
  }

  @Get('admin/services/by-name')
  @Auth(UserRole.ADMIN)
  getServiceByName(@Query('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('The name query parameter is required.');
    }
    return this.catalog.getServiceByName(name);
  }

  @Get('admin/services/:id')
  @Auth(UserRole.ADMIN)
  getServiceById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getServiceById(id);
  }

  @Post('services')
  @Auth(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a service under a parent category (admin only)' })
  @ApiBody({
    type: CreateServiceDto,
    examples: {
      default: {
        summary: 'Create service',
        value: {
          categoryId: '84cfa9af-05d4-40c1-ad36-123e412ec509',
          name: 'Plumbing',
          description: 'Leak repairs, pipe fitting, and drain unblocking.',
          keywords: 'leak repair, pipes, blocked drain',
          icon: 'wrench',
          bookingFee: 1000,
          emergencyVisitFee: 1500,
          sosBookingFee: 2500,
          isActive: true,
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'The created service, including its parent category details',
    schema: {
      example: {
        id: 'e5a4f4d7-0b21-46d8-9a4b-98765d332100',
        categoryId: '84cfa9af-05d4-40c1-ad36-123e412ec509',
        name: 'Plumbing',
        slug: 'plumbing',
        description: 'Leak repairs, pipe fitting, and drain unblocking.',
        keywords: 'leak repair, pipes, blocked drain',
        bookingFee: 1000,
        emergencyVisitFee: 1500,
        sosBookingFee: 2500,
        icon: 'wrench',
        isActive: true,
        createdAt: '2026-11-13T09:05:00.000Z',
        updatedAt: '2026-11-13T09:05:00.000Z',
        category: {
          id: '84cfa9af-05d4-40c1-ad36-123e412ec509',
          name: 'Home Services',
          description: 'Repairs and maintenance for homes.',
          isActive: true,
          createdAt: '2026-11-13T09:00:00.000Z',
          updatedAt: '2026-11-13T09:00:00.000Z',
        },
      },
    },
  })
  createService(
    @Body() dto: CreateServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createService(dto, user.id);
  }

  @Patch('services/:id')
  @Auth(UserRole.ADMIN)
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateService(id, dto, user.id);
  }

  @Delete('services/:id')
  @Auth(UserRole.ADMIN)
  deactivateService(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.deactivateService(id, user.id);
  }
}
