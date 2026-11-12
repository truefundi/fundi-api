import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth, AuthUser, CurrentUser } from '../common/decorators/auth.decorator';
import {
  ApiForbidden,
  ApiNotFound,
  ApiTokenRequired,
  ApiValidationFailed,
} from '../common/decorators/api-error-responses.decorator';
import { BroadcastsService } from './broadcasts.service';
import { BroadcastAudienceDto, ListBroadcastsQueryDto, SendBroadcastDto } from './dto/broadcast.dto';
import { BroadcastResponseDto } from './dto/broadcast-response.dto';

// Dashboard broadcast compose screen and history.
@ApiTags('Admin broadcasts')
@Controller('api/v1/admin/broadcasts')
@Auth(UserRole.ADMIN)
export class AdminBroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  // Counts the reachable audience before the operator confirms sending.
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a broadcast audience (admin only)',
    description:
      'Counts active customers and/or technicians and how many of them have a phone number. ' +
      'Administrators are never included.',
  })
  @ApiResponse({
    status: 200,
    description: 'Audience sizes',
    schema: {
      example: { userCount: 842, smsRecipientCount: 842, inAppRecipientCount: 842 },
    },
  })
  @ApiValidationFailed()
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  preview(@Body() body: BroadcastAudienceDto) {
    return this.broadcasts.preview(body);
  }

  @Get()
  @ApiOperation({ summary: 'List broadcast history (admin only)' })
  @ApiResponse({ status: 200, description: 'A page of broadcasts, newest first' })
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  list(@Query() query: ListBroadcastsQueryDto) {
    return this.broadcasts.list(query);
  }

  @Post()
  @ApiOperation({
    summary: 'Send a broadcast now (admin only)',
    description:
      'Delivers to every active account in the selected roles. IN_APP writes to the ' +
      'existing notification inbox and emits `notification:new`; SMS also texts each ' +
      'recipient. The response reports per-channel delivery counts and a status of ' +
      'SENT, PARTIAL, or FAILED.',
  })
  @ApiResponse({ status: 201, description: 'The sent broadcast', type: BroadcastResponseDto })
  @ApiValidationFailed()
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  send(@CurrentUser() admin: AuthUser, @Body() body: SendBroadcastDto) {
    return this.broadcasts.send(admin.id, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one broadcast with its delivery counts (admin only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The broadcast', type: BroadcastResponseDto })
  @ApiNotFound('No broadcast has this id.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.broadcasts.get(id);
  }
}
