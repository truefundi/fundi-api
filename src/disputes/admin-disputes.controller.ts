import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { DisputesService } from './disputes.service';
import {
  ListDisputesQueryDto,
  ResolveDisputeDto,
} from './dto/dispute.dto';

@ApiTags('Admin disputes')
@Controller('api/v1/admin/disputes')
@Auth(UserRole.ADMIN)
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  @ApiOperation({
    summary: 'List disputes (admin only)',
    description:
      'Returns the disputed jobs, newest first, filtered by state. Each job carries ' +
      'its `dispute` (reason, opener, and the resolution when decided).',
  })
  @ApiResponse({ status: 200, description: 'Disputed jobs' })
  list(@Query() query: ListDisputesQueryDto) {
    return this.disputes.listForAdmin(query.state);
  }

  @Get(':jobId')
  @ApiOperation({
    summary: 'Read one dispute (admin only)',
    description:
      'The disputed job together with its conversation, or 404 when the job has no dispute.',
  })
  @ApiResponse({ status: 200, description: 'The job and its chat' })
  get(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.disputes.getForAdmin(jobId);
  }

  @Post(':jobId/resolve')
  @ApiOperation({
    summary: 'Resolve a dispute (admin only)',
    description:
      'Records the outcome, the amount the customer must settle, and the reasoning. ' +
      'A dispute can only be resolved once.',
  })
  @ApiResponse({ status: 201, description: 'The job with its resolved dispute' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputes.resolve(jobId, dto, user.id);
  }
}
