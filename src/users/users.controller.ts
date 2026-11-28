import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { BearerOnly } from '../auth/bearer-only.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { PaginatedUsersResponseDto } from './dto/paginated-users-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { SwitchRoleDto } from './dto/switch-role.dto';
import {
  Auth,
  StaffAuth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { UserRole } from '@prisma/client';
import {
  ApiBadRequest,
  ApiConflict,
  ApiForbidden,
  ApiNotFound,
  ApiTokenRequired,
  ApiValidationFailed,
} from '../common/decorators/api-error-responses.decorator';

@ApiTags('users')
@Controller('api/v1/users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me/technician-eligibility')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  technicianEligibility(@CurrentUser() user: AuthUser) {
    return this.usersService.getTechnicianEligibility(user.id);
  }

  @Patch('me/role')
  @Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
  switchRole(@CurrentUser() user: AuthUser, @Body() dto: SwitchRoleDto) {
    return this.usersService.switchRole(user.id, dto.role);
  }

  // Allows a signed-in user to edit profile fields but not role or status.
  @Patch('me')
  @BearerOnly()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @ApiOperation({ summary: 'Update the current account profile' })
  @ApiResponse({
    status: 200,
    description: 'The updated user record',
    type: UserResponseDto,
  })
  @ApiTokenRequired()
  @ApiForbidden('The account is no longer active.')
  @ApiConflict(
    'The new phone number or email already belongs to another account.',
  )
  @ApiValidationFailed()
  async updateAccount(
    @Req() request: { user: { userId: string } },
    @Body() body: UpdateAccountDto,
  ) {
    return this.usersService.updateAccount(request.user.userId, body);
  }

  // Allows a signed-in user to permanently delete their own account.
  @Delete('me')
  @BearerOnly()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('accessToken')
  @ApiOperation({
    summary: 'Delete the current account',
    description: 'Permanent. Cascades to the account refresh-token rows.',
  })
  @ApiResponse({ status: 200, description: 'The account was deleted' })
  @ApiTokenRequired()
  @ApiForbidden('The account is no longer active.')
  @ApiNotFound('The account no longer exists.')
  async deleteAccount(@Req() request: { user: { userId: string } }) {
    return this.usersService.deleteAccount(request.user.userId);
  }

  // Creates a user account with administrative role and status controls.
  @Post()
  @StaffAuth('users.manage')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({ summary: 'Create a user (admin only)' })
  @ApiResponse({
    status: 201,
    description: 'The created user record',
    type: UserResponseDto,
  })
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  @ApiConflict('A user with this phone number or email already exists.')
  @ApiValidationFailed()
  async create(@Body() body: CreateUserDto, @CurrentUser() user: AuthUser) {
    return this.usersService.create(body, user.id);
  }

  // Lists accounts for administrator review with paging, filters, and search.
  @Get()
  @StaffAuth('users.view')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({
    summary: 'List users with pagination, filters, and search (admin only)',
    description:
      'Returns one page of users, newest first, wrapped in a `{ data, pagination }` envelope. ' +
      'All filters (`role`, `status`, `search`) combine and are applied inside the database query.',
  })
  @ApiResponse({
    status: 200,
    description: 'One page of users plus pagination metadata',
    type: PaginatedUsersResponseDto,
  })
  @ApiValidationFailed()
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async findAll(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.findAll(query, user.id);
  }

  // Finds all accounts matching a phone, full-name, or email fragment.
  @Get('search')
  @StaffAuth('users.view')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({
    summary: 'Search users by phone number, full name, or email (admin only)',
    description:
      'Matches a substring of any of the three fields. Full-name and email matching are case-insensitive.',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching user records',
    type: [UserResponseDto],
  })
  @ApiBadRequest('The `query` parameter is required and must not be empty.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async search(@Query('query') query: string, @CurrentUser() user: AuthUser) {
    return this.usersService.search(query, user.id);
  }

  // Finds one account by its unique email address.
  @Get('by-email')
  @StaffAuth('users.view')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({ summary: 'Get a user by email (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'One full user record',
    type: UserResponseDto,
  })
  @ApiBadRequest('The `email` query parameter is required.')
  @ApiNotFound('No user was found with that email address.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async findByEmail(
    @Query('email') email: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (!email?.trim())
      throw new BadRequestException('The email query parameter is required.');
    return this.usersService.getByEmail(email, user.id);
  }

  // Gets a single account by its database identifier.
  @Get(':id')
  @StaffAuth('users.view')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({ summary: 'Get a user by ID (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'One full user record',
    type: UserResponseDto,
  })
  @ApiBadRequest('The `id` path parameter must be a valid UUID.')
  @ApiNotFound('No user was found with that ID.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.getById(id, user.id);
  }

  // Updates an account's administrator-managed fields.
  @Patch(':id')
  @StaffAuth('users.manage')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({ summary: 'Update a user (admin only)' })
  @ApiResponse({
    status: 200,
    description: 'The updated user record',
    type: UserResponseDto,
  })
  @ApiNotFound('No user was found with that ID.')
  @ApiConflict(
    'The new phone number or email already belongs to another account.',
  )
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  @ApiValidationFailed()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.update(id, body, user.id);
  }

  // Changes a user's active status without exposing this action to customers.
  @Patch(':id/status')
  @StaffAuth('users.manage')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({
    summary: 'Change a user status (admin only)',
    description:
      'Setting `INACTIVE` blocks that account from logging in and from using existing sessions.',
  })
  @ApiResponse({
    status: 200,
    description: 'The updated user record',
    type: UserResponseDto,
  })
  @ApiNotFound('No user was found with that ID.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  @ApiValidationFailed()
  async updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStatusDto,
  ) {
    return this.usersService.updateStatus(id, body.status, user.id);
  }

  // Permanently deletes an account selected by an administrator.
  @Delete(':id')
  @StaffAuth('users.manage')
  @ApiCookieAuth('adminAccessToken')
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  @ApiResponse({ status: 200, description: 'The account was deleted' })
  @ApiNotFound('No user was found with that ID.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.delete(id, user.id);
  }
}
