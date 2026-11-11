import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  Auth,
  AuthUser,
  CurrentUser,
} from '../../common/decorators/auth.decorator';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { toStreamableFile } from './file.util';
import { TechnicianDocumentsService } from './technician-documents.service';

// Administrator review of technician documents and approval readiness.
@ApiTags('Admin technician documents')
@Controller('api/v1/admin')
export class TechnicianDocumentsAdminController {
  constructor(private readonly documents: TechnicianDocumentsService) {}

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
