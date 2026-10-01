import { Body, Controller, Get, Put } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { TechniciansService } from './technicians.service';
import { UpdateTechnicianProfileDto } from './dto/update-technician-profile.dto';

// Exposes the draft onboarding profile only to authenticated technician accounts.
@Controller('api/v1/technicians')
@Auth(UserRole.TECHNICIAN)
export class TechniciansController {
  constructor(private readonly technicians: TechniciansService) {}

  // Loads saved wizard data and creates an empty draft profile on first access.
  @Get('profile')
  getProfile(@CurrentUser() user: AuthUser) {
    return this.technicians.getMyProfile(user.id);
  }

  // Saves only provided fields so a technician can leave and resume onboarding.
  @Put('profile')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTechnicianProfileDto,
  ) {
    return this.technicians.updateProfile(user.id, dto);
  }
}
