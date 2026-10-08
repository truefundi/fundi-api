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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { PaginatedTechniciansResponseDto } from './dto/paginated-technicians-response.dto';
import { SearchAvailableTechniciansDto } from './dto/search-available-technicians.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { TechniciansService } from './technicians.service';

// Groups technician self-service and authenticated discovery endpoints.
@ApiTags('Technicians')
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

  // Approved + online. Optional paging and filter query parameters.
  @Get()
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'List available technicians (any signed-in role)',
    description:
      'Always constrained server-side to active, approved, online technicians. Optional filters ' +
      '(`categoryId`, `category`, `query`, `location`, `minYearsOfExperience`) and paging combine with that constraint.',
  })
  @ApiResponse({
    status: 200,
    description: 'One page of available technician profiles plus pagination metadata',
    type: PaginatedTechniciansResponseDto,
  })
  listAvailable(
    @CurrentUser() user: AuthUser,
    @Query() dto: SearchAvailableTechniciansDto,
  ) {
    const viewer = user.role === UserRole.ADMIN ? 'admin' : 'authenticated';
    return this.technicians.listAvailable(dto, viewer);
  }

  // Approved (online or offline). Optional paging and filter query parameters.
  @Get('approved')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
  @ApiOperation({
    summary: 'List approved technicians regardless of availability (any signed-in role)',
    description:
      'Always constrained server-side to active, approved technicians. Accepts the same filters and paging as GET /technicians.',
  })
  @ApiResponse({
    status: 200,
    description: 'One page of approved technician profiles plus pagination metadata',
    type: PaginatedTechniciansResponseDto,
  })
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