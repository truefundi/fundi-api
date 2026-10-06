import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { SearchAvailableTechniciansDto } from './dto/search-available-technicians.dto';
import { TechniciansService } from './technicians.service';

// Serves a limited technician-card projection suitable for landing pages.
@Controller('api/v1/public/technicians')
export class TechniciansPublicController {
  constructor(private readonly technicians: TechniciansService) {}

  // Lists only active, approved, online technicians without requiring sign-in.
  @Get()
  list(@Query() dto: SearchAvailableTechniciansDto) {
    return this.technicians.listPublic(dto);
  }

  // Returns safe marketplace details for one technician who is currently available.
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.technicians.getPublicById(id);
  }
}