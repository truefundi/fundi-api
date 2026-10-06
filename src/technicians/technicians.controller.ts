import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { SearchAvailableTechniciansDto } from './dto/search-available-technicians.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { TechniciansService } from './technicians.service';

// Groups technician self-service and authenticated discovery endpoints.
@Controller('api/v1/technicians')
export class TechniciansController {
  constructor(private readonly technicians: TechniciansService) {}

  // ─── Technician self-service ──────────────────────────────────────────

  @Post('profile')
  @Auth(UserRole.TECHNICIAN)
  registerProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTechnicianProfileDto,
  ) {
    return this.technicians.registerMyProfile(user.id, dto);
  }

  @Get('profile')
  @Auth(UserRole.TECHNICIAN)
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.technicians.getMyProfile(user.id);
  }

  @Put('profile')
  @Auth(UserRole.TECHNICIAN)
  updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTechnicianProfileDto,
  ) {
    return this.technicians.updateMyProfile(user.id, dto);
  }

  @Patch('availability')
  @Auth(UserRole.TECHNICIAN)
  updateMyAvailability(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.technicians.updateMyAvailability(
      user.id,
      dto.availabilityStatus,
    );
  }

  // ─── Authenticated discovery (any logged-in role) ─────────────────────

  // Approved + online. Optional ?categoryId= and ?query= filters.
  @Get()
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
  listAvailable(
    @CurrentUser() user: AuthUser,
    @Query() dto: SearchAvailableTechniciansDto,
  ) {
    const viewer = user.role === UserRole.ADMIN ? 'admin' : 'authenticated';
    return this.technicians.listAvailable(dto, viewer);
  }

  // Approved (online or offline). Optional ?categoryId= and ?query= filters.
  @Get('approved')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
  listApproved(
    @CurrentUser() user: AuthUser,
    @Query() dto: SearchAvailableTechniciansDto,
  ) {
    const viewer = user.role === UserRole.ADMIN ? 'admin' : 'authenticated';
    return this.technicians.listApproved(dto, viewer);
  }

  // Approved + online, single record.
  @Get('available/:id')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
  getAvailableById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const viewer = user.role === UserRole.ADMIN ? 'admin' : 'authenticated';
    return this.technicians.getAvailableById(id, viewer);
  }

  // Approved (online or offline), single record.
  @Get('approved/:id')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
  getApprovedById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const viewer = user.role === UserRole.ADMIN ? 'admin' : 'authenticated';
    return this.technicians.getApprovedById(id, viewer);
  }
}