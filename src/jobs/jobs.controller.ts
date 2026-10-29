import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../common/decorators/auth.decorator';
import { JOB_MAX_VIDEO_BYTES } from './job.constants';
import { JobProgressDto } from './dto/job-action.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { JobUpload } from './job-media.util';
import { JobsService } from './jobs.service';
import { CreateJobMultipartDto } from './dto/create-job-multipart.dto';

const JOB_MEDIA_INTERCEPTOR = FileFieldsInterceptor(
  [
    { name: 'photos', maxCount: 5 },
    { name: 'video', maxCount: 1 },
  ],
  {
    limits: {
      files: 6,
      fileSize: JOB_MAX_VIDEO_BYTES,
      fields: 20,
      fieldSize: 10_000,
    },
  },
);

interface JobUploadFields {
  photos?: JobUpload[];
  video?: JobUpload[];
}

@ApiTags('Customer jobs')
@Controller('api/v1/jobs')
@Auth(UserRole.CUSTOMER)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @UseInterceptors(JOB_MEDIA_INTERCEPTOR)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateJobMultipartDto })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateJobMultipartDto,
    @UploadedFiles() files: JobUploadFields,
  ) {
    return this.jobs.create(user.id, dto, files.photos ?? [], files.video?.[0]);
  }

  @Get('mine')
  listMine(@CurrentUser() user: AuthUser) {
    return this.jobs.listForCustomer(user.id);
  }

  @Get('mine/:jobId')
  getMine(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.getCustomerJob(user.id, jobId);
  }

  @Patch('mine/:jobId')
  updateMine(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobs.update(user.id, jobId, dto);
  }

  @Patch('mine/:jobId/progress')
  updateProgress(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body() dto: JobProgressDto,
  ) {
    return this.jobs.updateProgress(user.id, jobId, 'customer', dto);
  }

  @Post('mine/:jobId/retry-dispatch')
  retryDispatch(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.retryDispatch(user.id, jobId);
  }

  @Post('mine/:jobId/accept')
  acceptTechnicianOffer(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.acceptTechnicianOffer(user.id, jobId);
  }

  @Delete('mine/:jobId')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.cancel(user.id, jobId);
  }

  @Post('mine/:jobId/media')
  @UseInterceptors(JOB_MEDIA_INTERCEPTOR)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        photos: {
          type: 'array',
          maxItems: 5,
          items: { type: 'string', format: 'binary' },
        },
        video: { type: 'string', format: 'binary' },
      },
    },
  })
  addMedia(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @UploadedFiles() files: JobUploadFields,
  ) {
    return this.jobs.addMedia(
      user.id,
      jobId,
      files.photos ?? [],
      files.video?.[0],
    );
  }

  @Delete('mine/:jobId/media/:mediaId')
  deleteMedia(
    @CurrentUser() user: AuthUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.jobs.deleteMedia(user.id, jobId, mediaId);
  }
}
