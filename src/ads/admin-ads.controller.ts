import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Auth, AuthUser, CurrentUser } from '../common/decorators/auth.decorator';
import {
  ApiForbidden,
  ApiNotFound,
  ApiTokenRequired,
  ApiValidationFailed,
} from '../common/decorators/api-error-responses.decorator';
import { MAX_UPLOAD_BYTES, UploadedFileData } from '../technicians/documents/file.util';
import { AdsService } from './ads.service';
import { AdResponseDto } from './dto/ad-response.dto';
import { CreateAdDto, ListAdsQueryDto, UpdateAdDto } from './dto/ad.dto';

const UPLOAD_LIMITS = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } };

// Dashboard management for promotion cards.
@ApiTags('Admin ads')
@Controller('api/v1/admin/ads')
@Auth(UserRole.ADMIN)
export class AdminAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  @ApiOperation({
    summary: 'List every ad (admin only)',
    description: 'Includes hidden and out-of-window ads, newest and highest priority first.',
  })
  @ApiResponse({ status: 200, description: 'A page of ads' })
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  list(@Query() query: ListAdsQueryDto) {
    return this.ads.listAdmin(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create an ad (admin only)' })
  @ApiResponse({ status: 201, description: 'The created ad', type: AdResponseDto })
  @ApiValidationFailed()
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  create(@CurrentUser() admin: AuthUser, @Body() body: CreateAdDto) {
    return this.ads.create(admin.id, body);
  }

  @Put(':id/image')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload or replace an ad creative (admin only)',
    description:
      'The bytes are sniffed, so a renamed file is refused. JPEG, PNG, and WebP up to 5 MiB. ' +
      'Replacing a creative deletes the previous object.',
  })
  @ApiResponse({ status: 200, description: 'The updated ad', type: AdResponseDto })
  @ApiValidationFailed()
  @ApiNotFound('No ad has this id.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  uploadImage(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedFileData,
  ) {
    return this.ads.uploadImage(id, admin.id, file);
  }

  @Delete(':id/image')
  @ApiOperation({ summary: 'Remove an uploaded ad creative (admin only)' })
  @ApiResponse({ status: 200, description: 'The image was removed' })
  @ApiNotFound('No ad has this id, or it has no uploaded image.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  removeImage(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ads.removeImage(id, admin.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one ad (admin only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The ad', type: AdResponseDto })
  @ApiNotFound('No ad has this id.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.ads.getAdmin(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an ad (admin only)',
    description:
      'Every field is optional, so the dashboard can flip `isActive` or change the ' +
      'schedule without resending the whole card.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The updated ad', type: AdResponseDto })
  @ApiValidationFailed()
  @ApiNotFound('No ad has this id.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  update(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdDto,
  ) {
    return this.ads.update(id, admin.id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an ad (admin only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'The ad was deleted' })
  @ApiNotFound('No ad has this id.')
  @ApiTokenRequired()
  @ApiForbidden('The caller is not an administrator.')
  remove(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.ads.remove(id, admin.id);
  }
}
