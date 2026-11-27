import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CertificateType, DocumentType, UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../../common/decorators/auth.decorator';
import { TechniciansService } from '../technicians.service';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import {
  MAX_UPLOAD_BYTES,
  toInlineFile,
  toStreamableFile,
  UploadedFileData,
} from './file.util';
import { TechnicianDocumentsService } from './technician-documents.service';

const UPLOAD_LIMITS = { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } };

// Administrator review of technician documents and approval readiness.
@ApiTags('Admin technician documents')
@Controller('api/v1/admin')
export class TechnicianDocumentsAdminController {
  constructor(
    private readonly documents: TechnicianDocumentsService,
    private readonly technicians: TechniciansService,
  ) {}

  @Put('technicians/:id/picture')
  @Auth(UserRole.ADMIN)
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
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) profileId: string,
    @UploadedFile() file: UploadedFileData,
  ) {
    const technician = await this.technicians.getByIdForAdmin(profileId);
    await this.documents.replaceProfilePicture(technician.user.id, file, admin.id);
    return this.technicians.getByIdForAdmin(profileId);
  }

  @Get('technicians/:id/picture')
  @Auth(UserRole.ADMIN)
  @Header('X-Content-Type-Options', 'nosniff')
  async downloadPicture(@Param('id', ParseUUIDPipe) profileId: string) {
    return toInlineFile(
      await this.documents.downloadProfilePictureForAdmin(profileId),
    );
  }

  @Post('technicians/:id/documents')
  @Auth(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'type', 'title'],
      properties: {
        file: { type: 'string', format: 'binary' },
        type: {
          type: 'string',
          enum: Object.values(DocumentType),
          description: 'NATIONAL_ID or CERTIFICATE.',
        },
        title: { type: 'string', example: 'National ID (front and back)' },
        certificateType: {
          type: 'string',
          enum: Object.values(CertificateType),
          description: 'Required when type is CERTIFICATE.',
        },
        categoryId: {
          type: 'string',
          format: 'uuid',
          description:
            'Required when type is CERTIFICATE: UUID of an active service category. Mutually exclusive with customCategoryName.',
        },
        customCategoryName: {
          type: 'string',
          example: 'Solar Panel Install',
          description:
            'Required when type is CERTIFICATE and the service is not in the catalogue. Mutually exclusive with categoryId.',
        },
      },
    },
  })
  async uploadDocument(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) profileId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedFileData,
  ) {
    const technician = await this.technicians.getByIdForAdmin(profileId);
    return this.documents.uploadDocument(technician.user.id, dto, file, admin.id);
  }

  // Lists all documents of one technician profile.
  @Get('technicians/:id/documents')
  @Auth(UserRole.ADMIN)
  listDocuments(@Param('id', ParseUUIDPipe) profileId: string) {
    return this.documents.listForTechnician(profileId);
  }

  // Shows whether a technician meets the approval requirements.
  @Get('technicians/:id/verification-checklist')
  @Auth(UserRole.ADMIN)
  getChecklist(@Param('id', ParseUUIDPipe) profileId: string) {
    return this.documents.getChecklist(profileId);
  }

  // Downloads any technician document for review.
  @Get('technician-documents/:documentId/download')
  @Auth(UserRole.ADMIN)
  @Header('X-Content-Type-Options', 'nosniff')
  async download(@Param('documentId', ParseUUIDPipe) documentId: string) {
    return toStreamableFile(await this.documents.downloadForAdmin(documentId));
  }

  // Marks a document REVIEWING, ACCEPTED, or DENIED (a note is required to deny).
  @Patch('technician-documents/:documentId/review')
  @Auth(UserRole.ADMIN)
  review(
    @CurrentUser() admin: AuthUser,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.documents.review(documentId, dto, admin.id);
  }
}
