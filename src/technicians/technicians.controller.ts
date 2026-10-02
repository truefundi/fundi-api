import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';
import { TechniciansService } from './technicians.service';

// Groups technician self-service and customer discovery endpoints.
@Controller('api/v1/technicians')
export class TechniciansController {
  constructor(private readonly technicians: TechniciansService) {}

  // Creates a technician profile with any available fields; PUT completes it later.
  @Post('profile')
  @Auth(UserRole.TECHNICIAN)
  registerProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTechnicianProfileDto,
  ) {
    return this.technicians.registerMyProfile(user.id, dto);
  }

  // Returns the technician's complete account and profile details.
  @Get('profile')
  @Auth(UserRole.TECHNICIAN)
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.technicians.getMyProfile(user.id);
  }

  // Saves user and technician profile fields in one atomic request.
  @Put('profile')
  @Auth(UserRole.TECHNICIAN)
  updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTechnicianProfileDto,
  ) {
    return this.technicians.updateMyProfile(user.id, dto);
  }

  // Lets an approved technician switch online or offline.
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

  // Lists only available technicians for signed-in customers.
  @Get()
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  listAvailable() {
    return this.technicians.listAvailable();
  }

  // Returns the full public details of one available technician.
  @Get(':id')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  getAvailableById(@Param('id', ParseUUIDPipe) id: string) {
    return this.technicians.getAvailableById(id);
  }
}
