import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { DisputesService } from './disputes.service';
import { OpenDisputeDto } from './dto/dispute.dto';

/**
 * Dispute lifecycle for the two parties. The admin module owns the review side
 * (list/detail/resolve); this controller owns opening a dispute on a job.
 */
@ApiTags('Disputes')
@Controller('api/v1/disputes')
@Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post(':jobId')
  @ApiOperation({
    summary: 'Open a dispute on a job',
    description:
      'Either the customer or the assigned technician may open a dispute on a job. ' +
      'One dispute may exist per job; the admin later reviews and resolves it.',
  })
  @ApiResponse({ status: 201, description: 'The job with its open dispute' })
  open(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.disputes.open(user.id, jobId, dto);
  }
}
