import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { DocumentType, UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../../common/decorators/auth.decorator';
import { TechniciansService } from '../technicians.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import {
  MAX_UPLOAD_BYTES,
  toStreamableFile,
  UploadedFileData,
} from './file.util';
import { TechnicianDocumentsService } from './technician-documents.service';

const UPLOAD_LIMITS = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } };

// Technician self-service for the profile picture and KYC documents.
@ApiTags('Technician documents')
@Controller('api/v1/technicians/profile')
export class TechnicianDocumentsController {
  constructor(
    private readonly documents: TechnicianDocumentsService,
    private readonly technicians: TechniciansService,
  ) {}

  // Uploads or replaces the profile picture (JPEG, PNG or WebP, up to 5 MiB).
  @Put('picture')
  @Auth(UserRole.TECHNICIAN)
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadPicture(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedFileData,
  ) {
    await this.documents.replaceProfilePicture(user.id, file);
    return this.technicians.getMyProfile(user.id);
  }

  // Removes the profile picture.
  @Delete('picture')
  @Auth(UserRole.TECHNICIAN)
  async deletePicture(@CurrentUser() user: AuthUser) {
    await this.documents.removeProfilePicture(user.id);
    return this.technicians.getMyProfile(user.id);
  }

  // Shows what is still missing before an administrator can approve the technician.
  @Get('verification-checklist')
  @Auth(UserRole.TECHNICIAN)
  getChecklist(@CurrentUser() user: AuthUser) {
    return this.documents.getChecklistForUser(user.id);
  }

  // Uploads a KYC document (JPEG, PNG, WebP or PDF, up to 5 MiB).
  @Post('documents')
  @Auth(UserRole.TECHNICIAN)
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type', 'title'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', enum: Object.values(DocumentType) },
        title: { type: 'string', example: 'National ID (front and back)' },
      },
    },
  })
  uploadDocument(
    @CurrentUser() user: AuthUser,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedFileData,
  ) {
    return this.documents.uploadDocument(user.id, dto, file);
  }

  // Lists the technician's own documents and their review status.
  @Get('documents')
  @Auth(UserRole.TECHNICIAN)
  listDocuments(@CurrentUser() user: AuthUser) {
    return this.documents.listMine(user.id);
  }

  // Downloads one of the technician's own documents.
  @Get('documents/:documentId/download')
  @Auth(UserRole.TECHNICIAN)
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return toStreamableFile(
      await this.documents.downloadForOwner(user.id, documentId),
    );
  }

  // Deletes a document that is still SUBMITTED or was DENIED.
  @Delete('documents/:documentId')
  @Auth(UserRole.TECHNICIAN)
  deleteDocument(
    @CurrentUser() user: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.documents.deleteMine(user.id, documentId);
  }
}
