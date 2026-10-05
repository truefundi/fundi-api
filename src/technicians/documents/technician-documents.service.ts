import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentStatus,
  DocumentType,
  Prisma,
  TechnicianDocument,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import {
  detectFileType,
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  UploadedFileData,
} from './file.util';

const MAX_ACTIVE_DOCUMENTS = 10;

// Document types an administrator must accept before a technician can be approved.
export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = [
  DocumentType.NATIONAL_ID,
  DocumentType.TVET_CERTIFICATE,
];

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  NATIONAL_ID: 'Accepted National ID document',
  TVET_CERTIFICATE: 'Accepted TVET certificate',
};

export interface ChecklistItem {
  key: string;
  label: string;
  satisfied: boolean;
  detail: string;
}

export interface VerificationChecklist {
  complete: boolean;
  items: ChecklistItem[];
}

// Handles private technician files: profile pictures, KYC documents, review, and the approval checklist.
@Injectable()
export class TechnicianDocumentsService {
  private readonly logger = new Logger(TechnicianDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ---------- Technician: profile picture ----------

  // Stores a new profile picture and removes the previous one.
  async replaceProfilePicture(
    userId: string,
    file: UploadedFileData | undefined,
  ) {
    const profile = await this.requireProfile(userId);
    const detected = this.validateFile(file, IMAGE_MIME_TYPES);
    const objectKey = `technicians/${profile.id}/profile/${randomUUID()}.${detected.extension}`;

    await this.storage.put(objectKey, file!.buffer, detected.mime);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.technicianProfile.update({
          where: { id: profile.id },
          data: {
            profilePictureObjectKey: objectKey,
            profilePictureMimeType: detected.mime,
          },
        });
        await this.audit.log(
          {
            entityType: 'TechnicianProfile',
            entityId: profile.id,
            action: 'PROFILE_PICTURE_UPDATED',
            actorId: userId,
          },
          tx,
        );
      });
    } catch (error) {
      await this.deleteQuietly(objectKey);
      throw error;
    }
    if (profile.profilePictureObjectKey) {
      await this.deleteQuietly(profile.profilePictureObjectKey);
    }
  }

  // Clears the profile picture and deletes the stored file.
  async removeProfilePicture(userId: string) {
    const profile = await this.requireProfile(userId);
    if (!profile.profilePictureObjectKey) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.technicianProfile.update({
        where: { id: profile.id },
        data: { profilePictureObjectKey: null, profilePictureMimeType: null },
      });
      await this.audit.log(
        {
          entityType: 'TechnicianProfile',
          entityId: profile.id,
          action: 'PROFILE_PICTURE_REMOVED',
          actorId: userId,
        },
        tx,
      );
    });
    await this.deleteQuietly(profile.profilePictureObjectKey);
  }

  // ---------- Technician: documents ----------

  // Validates and stores a KYC document, then records it as SUBMITTED.
  async uploadDocument(
    userId: string,
    dto: UploadDocumentDto,
    file: UploadedFileData | undefined,
  ) {
    const profile = await this.requireProfile(userId);
    const detected = this.validateFile(file, DOCUMENT_MIME_TYPES);
    const titleNormalized = this.normalizeTitle(dto.title);

    const activeCount = await this.prisma.technicianDocument.count({
      where: {
        technicianId: profile.id,
        status: { not: DocumentStatus.DENIED },
      },
    });
    if (activeCount >= MAX_ACTIVE_DOCUMENTS) {
      throw new ConflictException(
        `You can have at most ${MAX_ACTIVE_DOCUMENTS} active documents. Delete one first.`,
      );
    }
    // The database allows one live title per technician (any type) and one live National ID.
    const duplicateTitle = await this.prisma.technicianDocument.findFirst({
      where: {
        technicianId: profile.id,
        titleNormalized,
        status: { not: DocumentStatus.DENIED },
      },
      select: { id: true },
    });
    if (duplicateTitle) {
      throw new ConflictException(
        'You already have a document with this title. Use a different title, or wait until it is denied.',
      );
    }
    if (dto.type === DocumentType.NATIONAL_ID) {
      const liveNationalId = await this.prisma.technicianDocument.findFirst({
        where: {
          technicianId: profile.id,
          type: DocumentType.NATIONAL_ID,
          status: { not: DocumentStatus.DENIED },
        },
        select: { id: true },
      });
      if (liveNationalId) {
        throw new ConflictException(
          'A National ID document is already submitted. Delete it while it is still SUBMITTED, or wait until it is denied, before uploading another.',
        );
      }
    }

    const objectKey = `technicians/${profile.id}/documents/${randomUUID()}.${detected.extension}`;
    await this.storage.put(objectKey, file!.buffer, detected.mime);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const document = await tx.technicianDocument.create({
          data: {
            technicianId: profile.id,
            type: dto.type,
            title: dto.title,
            titleNormalized,
            objectKey,
            mimeType: detected.mime,
            originalFileName: this.cleanFileName(file!.originalname),
            sizeBytes: file!.buffer.length,
          },
        });
        await this.audit.log(
          {
            entityType: 'TechnicianDocument',
            entityId: document.id,
            action: 'DOCUMENT_UPLOADED',
            toStatus: DocumentStatus.SUBMITTED,
            actorId: userId,
            metadata: { technicianId: profile.id, type: dto.type },
          },
          tx,
        );
        return document;
      });
      return this.toResponse(created);
    } catch (error) {
      await this.deleteQuietly(objectKey);
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A matching document was submitted at the same time. Refresh and try again.',
        );
      }
      throw error;
    }
  }

  // Lists the signed-in technician's own documents.
  async listMine(userId: string) {
    const profile = await this.requireProfile(userId);
    const documents = await this.prisma.technicianDocument.findMany({
      where: { technicianId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((document) => this.toResponse(document));
  }

  // Returns the bytes of one of the technician's own documents.
  async downloadForOwner(userId: string, documentId: string) {
    const document = await this.prisma.technicianDocument.findFirst({
      where: { id: documentId, technician: { userId } },
    });
    if (!document) throw new NotFoundException('Document not found.');
    return this.readFile(document);
  }

  // Deletes an own document that has not been accepted or put under review.
  async deleteMine(userId: string, documentId: string) {
    const document = await this.prisma.technicianDocument.findFirst({
      where: { id: documentId, technician: { userId } },
    });
    if (!document) throw new NotFoundException('Document not found.');
    if (
      document.status !== DocumentStatus.SUBMITTED &&
      document.status !== DocumentStatus.DENIED
    ) {
      throw new ConflictException(
        'Documents under review or already accepted cannot be deleted.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.technicianDocument.delete({ where: { id: document.id } });
      await this.audit.log(
        {
          entityType: 'TechnicianDocument',
          entityId: document.id,
          action: 'DOCUMENT_DELETED',
          fromStatus: document.status,
          actorId: userId,
          metadata: { technicianId: document.technicianId },
        },
        tx,
      );
    });
    await this.deleteQuietly(document.objectKey);
    return { message: 'Document deleted successfully.' };
  }

  // ---------- Administrator ----------

  // Lists every document of one technician, including review details.
  async listForTechnician(profileId: string) {
    const exists = await this.prisma.technicianProfile.findUnique({
      where: { id: profileId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Technician not found.');
    const documents = await this.prisma.technicianDocument.findMany({
      where: { technicianId: profileId },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map((document) => this.toResponse(document, true));
  }

  // Returns the bytes of any document for review.
  async downloadForAdmin(documentId: string) {
    const document = await this.prisma.technicianDocument.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found.');
    return this.readFile(document);
  }

  // Moves a document through SUBMITTED -> REVIEWING -> ACCEPTED/DENIED; decided documents are final.
  async review(documentId: string, dto: ReviewDocumentDto, adminId: string) {
    const note = dto.reviewNote?.trim() || null;
    if (dto.status === DocumentStatus.DENIED && !note) {
      throw new BadRequestException(
        'A review note is required when denying a document.',
      );
    }
    const allowedFrom =
      dto.status === DocumentStatus.REVIEWING
        ? [DocumentStatus.SUBMITTED]
        : [DocumentStatus.SUBMITTED, DocumentStatus.REVIEWING];

    return this.prisma.$transaction(async (tx) => {
      const document = await tx.technicianDocument.findUnique({
        where: { id: documentId },
      });
      if (!document) throw new NotFoundException('Document not found.');

      const result = await tx.technicianDocument.updateMany({
        where: { id: documentId, status: { in: allowedFrom } },
        data: {
          status: dto.status,
          reviewNote: note,
          reviewedById: adminId,
          reviewedAt: new Date(),
        },
      });
      if (result.count === 0) {
        throw new ConflictException(
          `A ${document.status.toLowerCase()} document cannot be changed to ${dto.status.toLowerCase()}.`,
        );
      }
      await this.audit.log(
        {
          entityType: 'TechnicianDocument',
          entityId: documentId,
          action: 'DOCUMENT_REVIEWED',
          fromStatus: document.status,
          toStatus: dto.status,
          actorId: adminId,
          metadata: {
            technicianId: document.technicianId,
            type: document.type,
            reviewNote: note,
          },
        },
        tx,
      );
      const updated = await tx.technicianDocument.findUniqueOrThrow({
        where: { id: documentId },
      });
      return this.toResponse(updated, true);
    });
  }

  // ---------- Verification checklist ----------

  // Shows a technician what is still missing before they can be approved.
  async getChecklistForUser(userId: string) {
    const profile = await this.requireProfile(userId);
    return this.getChecklist(profile.id);
  }

  // Builds the approval checklist; pass a transaction client to read inside a transaction.
  async getChecklist(
    profileId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<VerificationChecklist> {
    const profile = await client.technicianProfile.findUnique({
      where: { id: profileId },
      select: {
        profilePictureObjectKey: true,
        documents: { select: { type: true, status: true } },
      },
    });
    if (!profile) throw new NotFoundException('Technician not found.');

    const items: ChecklistItem[] = [
      {
        key: 'PROFILE_PICTURE',
        label: 'Profile picture',
        satisfied: Boolean(profile.profilePictureObjectKey),
        detail: profile.profilePictureObjectKey ? 'Uploaded' : 'Not uploaded',
      },
      ...REQUIRED_DOCUMENT_TYPES.map((type) => {
        const documents = profile.documents.filter((d) => d.type === type);
        const has = (status: DocumentStatus) =>
          documents.some((d) => d.status === status);
        const detail = has(DocumentStatus.ACCEPTED)
          ? 'Accepted'
          : has(DocumentStatus.REVIEWING)
            ? 'Under review'
            : has(DocumentStatus.SUBMITTED)
              ? 'Submitted, waiting for review'
              : documents.length
                ? 'Denied, upload a new document'
                : 'Not uploaded';
        return {
          key: type,
          label: DOCUMENT_LABELS[type],
          satisfied: has(DocumentStatus.ACCEPTED),
          detail,
        };
      }),
    ];
    return { complete: items.every((item) => item.satisfied), items };
  }

  // Rejects approval with a clear list of what is missing.
  async assertReadyForApproval(
    tx: Prisma.TransactionClient,
    profileId: string,
  ) {
    const checklist = await this.getChecklist(profileId, tx);
    if (checklist.complete) return;
    const missing = checklist.items
      .filter((item) => !item.satisfied)
      .map((item) => item.label);
    throw new BadRequestException({
      message: `Cannot approve an incomplete submission. Missing: ${missing.join(', ')}.`,
      checklist,
    });
  }

  // ---------- Helpers ----------

  private async requireProfile(userId: string) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      select: { id: true, profilePictureObjectKey: true },
    });
    if (!profile) {
      throw new NotFoundException('Register your technician profile first.');
    }
    return profile;
  }

  // Checks size and real file type from the bytes, never from the client-supplied type.
  private validateFile(
    file: UploadedFileData | undefined,
    allowed: readonly string[],
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        'A non-empty file is required in the "file" field.',
      );
    }
    if (file.buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Files must be 5 MiB or smaller.');
    }
    const detected = detectFileType(file.buffer);
    if (!detected || !allowed.includes(detected.mime)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${allowed.join(', ')}.`,
      );
    }
    return detected;
  }

  private async readFile(document: TechnicianDocument) {
    return {
      buffer: await this.storage.get(document.objectKey),
      mimeType: document.mimeType,
      fileName: document.originalFileName,
    };
  }

  private normalizeTitle(title: string) {
    return title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Keeps only a plain file name for display; it is never used as a storage path.
  private cleanFileName(name: string) {
    const base = name.split(/[\\/]/).pop() ?? '';
    // eslint-disable-next-line no-control-regex
    const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return cleaned.slice(0, 200) || 'file';
  }

  private async deleteQuietly(objectKey: string) {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      this.logger.warn(
        `Could not delete stored file ${objectKey}: ${(error as Error).message}`,
      );
    }
  }

  // Never exposes the internal object key.
  private toResponse(document: TechnicianDocument, forAdmin = false) {
    return {
      id: document.id,
      technicianId: document.technicianId,
      type: document.type,
      title: document.title,
      mimeType: document.mimeType,
      originalFileName: document.originalFileName,
      sizeBytes: document.sizeBytes,
      status: document.status,
      reviewNote: document.reviewNote,
      reviewedAt: document.reviewedAt,
      ...(forAdmin && { reviewedById: document.reviewedById }),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}
