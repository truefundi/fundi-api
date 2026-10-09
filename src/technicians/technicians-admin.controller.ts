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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { AdminUpdateTechnicianDto } from './dto/admin-update-technician.dto';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { ListTechniciansQueryDto } from './dto/list-technicians-query.dto';
import { PaginatedTechniciansResponseDto } from './dto/paginated-technicians-response.dto';
import { SearchTechniciansDto } from './dto/search-technicians.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateVerificationStatusDto } from './dto/update-verification-status.dto';
import { TechniciansService } from './technicians.service';
import { SearchTechniciansByUserDto } from './dto/search-technicians-by-user.dto';

// Protects all technician management operations with the administrator role.
@ApiTags('Admin technicians')
@Controller('api/v1/admin/technicians')
@Auth(UserRole.ADMIN)
export class TechniciansAdminController {
  constructor(private readonly technicians: TechniciansService) {}

  // Creates a technician account and its associated profile.
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTechnicianDto) {
    return this.technicians.createByAdmin(dto, user.id);
  }

  // Lists technician accounts with paging, filters, and search.
  @Get()
  @ApiOperation({
    summary: 'List technicians with pagination, filters, and search (admin only)',
    description:
      'Returns one page of technician profiles, newest first, wrapped in a `{ data, pagination }` envelope. ' +
      'All filters combine and are applied inside the database query.',
  })
  @ApiResponse({
    status: 200,
    description: 'One page of technician profiles plus pagination metadata',
    type: PaginatedTechniciansResponseDto,
  })
  listAll(@Query() query: ListTechniciansQueryDto) {
    return this.technicians.listAllByAdmin(query);
  }

  // Searches all matching technician identity/profile fields and category membership.
  @Get('search')
  @ApiOperation({
    summary: 'Search technicians across profile, identity, and category fields (admin only)',
    description:
      'Accepts every list filter plus a broad `query` sweep (name, contacts, addresses, service names, exact coordinates) ' +
      'and an exact `nationalIdNumber` digest lookup. Results are paginated in a `{ data, pagination }` envelope.',
  })
  @ApiResponse({
    status: 200,
    description: 'One page of matching technician profiles plus pagination metadata',
    type: PaginatedTechniciansResponseDto,
  })
  search(@Query() query: SearchTechniciansDto) {
    return this.technicians.searchByAdmin(query);
  }

  @Get('by-user')
  searchByUser(@Query() query: SearchTechniciansByUserDto) {
    return this.technicians.searchByUserDetails(query);
  }


  // Changes verification state; non-approved technicians are forced offline.
  @Patch(':id/verification-status')
  updateVerificationStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateVerificationStatusDto,
  ) {
    return this.technicians.setVerificationStatus(
      id,
      dto.verificationStatus,
      user.id,
    );
  }

  // Changes technician availability subject to its approved verification state.
  @Patch(':id/availability-status')
  updateAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.technicians.setAvailabilityByAdmin(
      id,
      dto.availabilityStatus,
      user.id,
    );
  }

  // Returns the full technician account and profile record by profile ID.
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.technicians.getByIdForAdmin(id);
  }

  // Updates user identity, profile, categories, photo, or verification state.
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AdminUpdateTechnicianDto,
  ) {
    return this.technicians.updateByAdmin(id, dto, user.id);
  }

  // Deletes the technician account and cascades its related records.
  @Delete(':id')
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.technicians.deleteByAdmin(id, user.id);
  }
}
