import {
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
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../../common/decorators/auth.decorator';
import {
  AddTechnicianServiceDto,
  ListTechnicianServicesQueryDto,
  ReviewTechnicianServiceDto,
  UpdateTechnicianServiceDto,
} from './dto/technician-service.dto';
import { RequirePermissions } from '../../staff/permissions.guard';
import { TechnicianServicesService } from './technician-services.service';

@ApiTags('Technician services')
@Controller('api/v1/technicians/profile/services')
@Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
export class TechnicianServicesController {
  constructor(private readonly services: TechnicianServicesService) {}

  @Get()
  @ApiOperation({ summary: 'My services and where each review stands' })
  list(@CurrentUser() user: AuthUser) {
    return this.services.listMine(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Apply to offer another service',
    description:
      'Approved technicians only. The service waits for review and gets no jobs until an admin approves it. ' +
      'Upload its certificate with POST /technicians/profile/documents using the same categoryId.',
  })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddTechnicianServiceDto) {
    return this.services.add(user.id, dto);
  }

  @Patch(':serviceId')
  @ApiOperation({
    summary: 'Change a pending service, or send a rejected one back for review',
  })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateTechnicianServiceDto,
  ) {
    return this.services.update(user.id, serviceId, dto);
  }

  @Delete(':serviceId')
  @ApiOperation({ summary: 'Withdraw a pending or rejected service' })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  withdraw(
    @CurrentUser() user: AuthUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.services.withdraw(user.id, serviceId);
  }
}

@ApiTags('Admin technician services')
@Controller('api/v1/admin/technician-services')
@Auth(UserRole.ADMIN)
export class TechnicianServicesAdminController {
  constructor(private readonly services: TechnicianServicesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Services to review (PENDING by default), oldest first, with their certificates',
  })
  @RequirePermissions('technicians.view')
  list(@Query() query: ListTechnicianServicesQueryDto) {
    return this.services.listForReview(query);
  }

  @Patch(':serviceId/review')
  @ApiOperation({
    summary: 'Approve or reject one service',
    description:
      'A reason is required when rejecting; the technician is notified either way.',
  })
  @ApiParam({ name: 'serviceId', format: 'uuid' })
  @RequirePermissions('technicians.approve')
  review(
    @CurrentUser() user: AuthUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: ReviewTechnicianServiceDto,
  ) {
    return this.services.review(serviceId, user.id, dto);
  }
}
