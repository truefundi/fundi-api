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
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  StaffAuth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import {
  CreateServiceChargeDto,
  UpdateServiceChargeDto,
} from './dto/service-charge.dto';
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
  @StaffAuth('catalog.view')
  listAllCategories() {
    return this.catalog.listAllCategories();
  }

  @Get('admin/categories/by-name')
  @StaffAuth('catalog.view')
  getCategoryByName(@Query('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('The name query parameter is required.');
    }
    return this.catalog.getCategoryByName(name);
  }

  @Get('admin/categories/:id')
  @StaffAuth('catalog.view')
  getCategoryById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getCategoryById(id);
  }

  @Post('categories')
  @StaffAuth('catalog.manage')
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
  @StaffAuth('catalog.manage')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateCategory(id, dto, user.id);
  }

  @Delete('categories/:id')
  @StaffAuth('catalog.manage')
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
  @StaffAuth('catalog.view')
  listAllServices() {
    return this.catalog.listAllServices();
  }

  @Get('admin/services/by-name')
  @StaffAuth('catalog.view')
  getServiceByName(@Query('name') name: string) {
    if (!name?.trim()) {
      throw new BadRequestException('The name query parameter is required.');
    }
    return this.catalog.getServiceByName(name);
  }

  @Get('admin/services/:id')
  @StaffAuth('catalog.view')
  getServiceById(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getServiceById(id);
  }

  @Get('admin/services/:serviceCategoryId/charges')
  @StaffAuth('catalog.view')
  listServiceCharges(
    @Param('serviceCategoryId', ParseUUIDPipe) serviceCategoryId: string,
  ) {
    return this.catalog.listServiceCharges(serviceCategoryId);
  }

  @Post('admin/services/:serviceCategoryId/charges')
  @StaffAuth('catalog.manage')
  createServiceCharge(
    @Param('serviceCategoryId', ParseUUIDPipe) serviceCategoryId: string,
    @Body() dto: CreateServiceChargeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.createServiceCharge(serviceCategoryId, dto, user.id);
  }

  @Patch('admin/services/:serviceCategoryId/charges/:chargeId')
  @StaffAuth('catalog.manage')
  updateServiceCharge(
    @Param('serviceCategoryId', ParseUUIDPipe) serviceCategoryId: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @Body() dto: UpdateServiceChargeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateServiceCharge(
      serviceCategoryId,
      chargeId,
      dto,
      user.id,
    );
  }

  @Delete('admin/services/:serviceCategoryId/charges/:chargeId')
  @StaffAuth('catalog.manage')
  deleteServiceCharge(
    @Param('serviceCategoryId', ParseUUIDPipe) serviceCategoryId: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.deleteServiceCharge(
      serviceCategoryId,
      chargeId,
      user.id,
    );
  }

  @Post('services')
  @StaffAuth('catalog.manage')
  @ApiOperation({
    summary: 'Create a service under a parent category (admin only)',
  })
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
  createService(@Body() dto: CreateServiceDto, @CurrentUser() user: AuthUser) {
    return this.catalog.createService(dto, user.id);
  }

  @Patch('services/:id')
  @StaffAuth('catalog.manage')
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.updateService(id, dto, user.id);
  }

  @Delete('services/:id')
  @StaffAuth('catalog.manage')
  deactivateService(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.catalog.deactivateService(id, user.id);
  }
}
