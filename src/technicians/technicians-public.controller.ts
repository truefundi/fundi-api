import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PaginatedTechniciansResponseDto } from './dto/paginated-technicians-response.dto';
import { SearchAvailableTechniciansDto } from './dto/search-available-technicians.dto';
import { TechniciansService } from './technicians.service';

// Serves a limited technician-card projection suitable for landing pages.
@ApiTags('Public technicians')
@Controller('api/v1/public/technicians')
export class TechniciansPublicController {
  constructor(private readonly technicians: TechniciansService) {}

  // Lists only active, approved, online technicians without requiring sign-in.
  @Get()
  @ApiOperation({
    summary: 'List available technicians without signing in',
    description:
      'Always constrained server-side to active, approved, online technicians with a privacy-safe projection. ' +
      'Optional filters and paging match GET /api/v1/technicians.',
  })
  @ApiResponse({
    status: 200,
    description: 'One page of available technician profiles plus pagination metadata',
    type: PaginatedTechniciansResponseDto,
  })
  list(@Query() dto: SearchAvailableTechniciansDto) {
    return this.technicians.listPublic(dto);
  }

  // Returns safe marketplace details for one technician who is currently available.
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.technicians.getPublicById(id);
  }
}