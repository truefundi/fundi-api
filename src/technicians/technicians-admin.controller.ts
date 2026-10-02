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
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { AdminUpdateTechnicianDto } from './dto/admin-update-technician.dto';
import { CreateTechnicianDto } from './dto/create-technician.dto';
import { SearchTechniciansDto } from './dto/search-technicians.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateVerificationStatusDto } from './dto/update-verification-status.dto';
import { TechniciansService } from './technicians.service';

// Protects all technician management operations with the administrator role.
@Controller('api/v1/admin/technicians')
@Auth(UserRole.ADMIN)
export class TechniciansAdminController {
  constructor(private readonly technicians: TechniciansService) {}

  // Creates a technician account and its associated profile.
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTechnicianDto) {
    return this.technicians.createByAdmin(dto, user.id);
  }

  // Lists all technician accounts, including pending and offline records.
  @Get()
  listAll() {
    return this.technicians.listAllByAdmin();
  }

  // Searches all matching technician identity/profile fields and category membership.
  @Get('search')
  search(@Query() query: SearchTechniciansDto) {
    return this.technicians.searchByAdmin(query);
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
