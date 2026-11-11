import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { toInlineJobMedia } from './job-media.util';
import { JobsService } from './jobs.service';

@ApiTags('Job media')
@Controller('api/v1/jobs')
@Auth(UserRole.CUSTOMER, UserRole.TECHNICIAN, UserRole.ADMIN)
export class JobMediaController {
  constructor(private readonly jobs: JobsService) {}

  @Get(':jobId/media/:mediaId')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return toInlineJobMedia(
      await this.jobs.downloadMedia(user.id, user.role, jobId, mediaId),
    );
  }
}
