import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { UserResponseDto } from './dto/user-response.dto';
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

  // Allows a signed-in user to edit profile fields but not role or status.
  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update the current account profile',
    description:
      'Send only the fields to change. `fullName` is trimmed and must be 2 to 120 characters. `phoneNumber` has spaces, parentheses, and hyphens stripped. `email` is trimmed and lowercased, and an empty string clears it. At least one of the three fields is required.',
  })
  @ApiResponse({ status: 200, description: 'The updated user record', type: UserResponseDto })
  @ApiBadRequest('The body contains none of `fullName`, `phoneNumber`, or `email`.')
  @ApiTokenRequired()
  @ApiForbidden('The account is no longer active.')
  @ApiNotFound('The account no longer exists.')
  @ApiConflict('The new phone number or email already belongs to another account.')
  @ApiValidationFailed()
  async updateAccount(@Req() request: { user: { userId: string } }, @Body() body: UpdateAccountDto) {
    return this.usersService.updateAccount(request.user.userId, body);
  }

  // Allows a signed-in user to permanently delete their own account.
  @Delete('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
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
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a user (admin only)' })
  @ApiResponse({ status: 201, description: 'The created user record', type: UserResponseDto })
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  @ApiConflict('A user with this phone number or email already exists.')
  @ApiValidationFailed()
  async create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  // Lists accounts for administrator review.
  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all users (admin only)' })
  @ApiResponse({ status: 200, description: 'Every user, newest first', type: [UserResponseDto] })
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async findAll() {
    return this.usersService.findAll();
  }

  // Finds all accounts matching a phone fragment or full-name fragment.
  @Get('search')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Search users by phone number or full name (admin only)',
    description: 'Matches a substring of either field. Full-name matching is case-insensitive.',
  })
  @ApiResponse({ status: 200, description: 'Matching user records', type: [UserResponseDto] })
  @ApiBadRequest('The `query` parameter is required and must not be empty.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async search(@Query('query') query: string) {
    return this.usersService.search(query);
  }

  // Finds one account by its unique email address.
  @Get('by-email')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a user by email (admin only)' })
  @ApiResponse({ status: 200, description: 'One full user record', type: UserResponseDto })
  @ApiBadRequest('The `email` query parameter is required.')
  @ApiNotFound('No user was found with that email address.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async findByEmail(@Query('email') email: string) {
    if (!email?.trim()) throw new BadRequestException('The email query parameter is required.');
    return this.usersService.getByEmail(email);
  }

  // Gets a single account by its database identifier.
  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a user by ID (admin only)' })
  @ApiResponse({ status: 200, description: 'One full user record', type: UserResponseDto })
  @ApiNotFound('No user was found with that ID.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async findById(@Param('id') id: string) {
    return this.usersService.getById(id);
  }

  // Updates an account's administrator-managed fields.
  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a user (admin only)' })
  @ApiResponse({ status: 200, description: 'The updated user record', type: UserResponseDto })
  @ApiNotFound('No user was found with that ID.')
  @ApiConflict('The new phone number or email already belongs to another account.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  @ApiValidationFailed()
  async update(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.usersService.update(id, body);
  }

  // Changes a user's active status without exposing this action to customers.
  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change a user status (admin only)',
    description: 'Setting `INACTIVE` blocks that account from logging in and from using existing sessions.',
  })
  @ApiResponse({ status: 200, description: 'The updated user record', type: UserResponseDto })
  @ApiNotFound('No user was found with that ID.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  @ApiValidationFailed()
  async updateStatus(@Param('id') id: string, @Body() body: UpdateStatusDto) {
    return this.usersService.updateStatus(id, body.status);
  }

  // Permanently deletes an account selected by an administrator.
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  @ApiResponse({ status: 200, description: 'The account was deleted' })
  @ApiNotFound('No user was found with that ID.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an admin.')
  async delete(@Param('id') id: string) {
    return this.usersService.delete(id);
  }
}