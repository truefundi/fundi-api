import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import {
  AuthUser,
  CurrentUser,
  StaffAuth,
} from '../common/decorators/auth.decorator';
import {
  ListStaffDto,
  UpdateStaffPermissionsDto,
  UpdateStaffRoleDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';
import {
  PermissionModuleDto,
  StaffAccessDto,
  StaffPageDto,
} from './dto/staff-response.dto';

@ApiTags('Staff privileges')
@ApiUnauthorizedResponse({
  description: 'A valid dashboard cookie session is required.',
})
@Controller('api/v1/admin')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('permissions')
  @StaffAuth()
  @ApiOperation({ summary: 'List the permission catalog grouped by module' })
  @ApiOkResponse({ type: [PermissionModuleDto] })
  catalog() {
    return this.staff.catalog();
  }

  @Get('staff')
  @StaffAuth('staff.view')
  @ApiOperation({
    summary: 'List staff and their assigned/effective permissions',
  })
  @ApiOkResponse({ type: StaffPageDto })
  @ApiBadRequestResponse({
    description: 'Invalid pagination, role or search filter.',
  })
  list(@Query() query: ListStaffDto) {
    return this.staff.list(query);
  }

  @Get('staff/me/access')
  @StaffAuth()
  @ApiOperation({ summary: 'Get your current staff access and toggle states' })
  @ApiOkResponse({ type: StaffAccessDto })
  mine(@CurrentUser() user: AuthUser) {
    return this.staff.getAccess(user.id);
  }

  @Get('staff/:staffId/access')
  @StaffAuth('staff.view')
  @ApiOperation({
    summary: 'Get a staff member’s current access and grouped toggle states',
  })
  @ApiOkResponse({ type: StaffAccessDto })
  @ApiNotFoundResponse({ description: 'Staff member not found.' })
  access(@Param('staffId', ParseUUIDPipe) id: string) {
    return this.staff.getAccess(id);
  }

  @Patch('staff/:staffId/permissions')
  @StaffAuth('staff.manage')
  @ApiOperation({
    summary:
      'Atomically assign/revoke individual permissions (SUPER_ADMIN only)',
  })
  @ApiOkResponse({ type: StaffAccessDto })
  @ApiBadRequestResponse({
    description: 'Unknown, duplicate, reserved or malformed permission toggle.',
  })
  @ApiConflictResponse({
    description:
      'SUPER_ADMIN permissions cannot be changed, or the permission catalog migration is missing.',
  })
  @ApiNotFoundResponse({ description: 'Staff member not found.' })
  updatePermissions(
    @CurrentUser() user: AuthUser,
    @Param('staffId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffPermissionsDto,
  ) {
    return this.staff.updatePermissions(user.id, id, dto);
  }

  @Patch('staff/:staffId/role')
  @StaffAuth('staff.manage')
  @ApiOperation({
    summary: 'Change a staff responsibility label (SUPER_ADMIN only)',
  })
  @ApiOkResponse({ type: StaffAccessDto })
  @ApiBadRequestResponse({ description: 'A supported staff role is required.' })
  @ApiConflictResponse({
    description:
      'Self-lockout or removal of the last active SUPER_ADMIN is prohibited.',
  })
  @ApiNotFoundResponse({ description: 'Staff member not found.' })
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('staffId', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffRoleDto,
  ) {
    return this.staff.updateRole(user.id, id, dto.role);
  }
}
