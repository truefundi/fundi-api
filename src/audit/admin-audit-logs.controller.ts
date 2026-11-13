import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth } from '../common/decorators/auth.decorator';
import {
  ApiForbidden,
  ApiNotFound,
  ApiTokenRequired,
} from '../common/decorators/api-error-responses.decorator';
import { AuditService } from './audit.service';
import {
  AuditLogResponseDto,
  ListAuditLogsQueryDto,
  ListAuditLogsResponseDto,
} from './dto/audit-log.dto';

@ApiTags('Admin audit logs')
@Controller('api/v1/admin/audit-logs')
@Auth(UserRole.ADMIN)
export class AdminAuditLogsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'List audit logs (admin only)',
    description:
      'Returns audit trail entries, newest first. Supports filtering by entity, action, actor, and date range.',
  })
  @ApiResponse({
    status: 200,
    description: 'A page of audit log entries',
    type: ListAuditLogsResponseDto,
  })
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  list(@Query() query: ListAuditLogsQueryDto) {
    return this.audit.list({
      entityType: query.entityType,
      entityId: query.entityId,
      action: query.action,
      actorId: query.actorId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one audit log entry (admin only)',
    description: 'Returns a single audit log entry by id.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'The audit log entry',
    type: AuditLogResponseDto,
  })
  @ApiNotFound('No audit log entry has this id.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.audit.get(id);
  }
}
