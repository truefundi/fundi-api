import { ConflictException, NotFoundException } from '@nestjs/common';
import { DocumentStatus, DocumentType } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { StorageService } from '../../storage/storage.service';
import { TechnicianDocumentsService } from './technician-documents.service';

describe('TechnicianDocumentsService', () => {
  const userId = 'technician-user';
  const profileId = 'technician-profile';
  const documentId = 'denied-document';
  const oldObjectKey = 'technicians/technician-profile/documents/old.png';
  const now = new Date('2026-11-11T10:00:00.000Z');

  const deniedDocument = () => ({
    id: documentId,
    technicianId: profileId,
    type: DocumentType.NATIONAL_ID,
    title: 'National ID',
    titleNormalized: 'national id',
    objectKey: oldObjectKey,
    mimeType: 'image/png',
    originalFileName: 'old.png',
    sizeBytes: 100,
    status: DocumentStatus.DENIED,
    reviewNote: 'Image is blurry',
    reviewedById: 'admin-id',
    reviewedAt: now,
    createdAt: now,
    updatedAt: now,
    certificateType: null,
    categoryId: null,
    customCategoryName: null,
    customCategoryNormalized: null,
  });

  const createService = (
    status: DocumentStatus | null = DocumentStatus.DENIED,
  ) => {
    const updatedDocument = {
      ...deniedDocument(),
      status: DocumentStatus.SUBMITTED,
      reviewNote: null,
      reviewedById: null,
      reviewedAt: null,
      objectKey: 'replacement-object-key',
      mimeType: 'image/png',
      originalFileName: 'replacement.png',
      sizeBytes: 8,
      category: null,
    };
    const transaction = {
      technicianDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updatedDocument),
      },
    };
    const prisma = {
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: profileId }),
      },
      technicianDocument: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(
            status ? { ...deniedDocument(), status } : null,
          )
          .mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = { create: jest.fn() };
    return {
      service: new TechnicianDocumentsService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
        storage as unknown as StorageService,
        notifications as unknown as NotificationsService,
      ),
      prisma,
      transaction,
      audit,
      storage,
    };
  };

  const replacementFile = {
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    originalname: 'replacement.png',
    size: 8,
  };

  it('replaces a denied document and resubmits the same record', async () => {
    const { service, transaction, audit, storage } = createService();

    const result = await service.updateDeniedDocument(
      userId,
      documentId,
      { title: 'Corrected National ID' },
      replacementFile,
    );

    expect(transaction.technicianDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: documentId,
          technicianId: profileId,
          status: DocumentStatus.DENIED,
        },
        data: expect.objectContaining({
          title: 'Corrected National ID',
          status: DocumentStatus.SUBMITTED,
          reviewNote: null,
          reviewedById: null,
          reviewedAt: null,
        }),
      }),
    );
    expect(result).toMatchObject({
      id: documentId,
      status: DocumentStatus.SUBMITTED,
      reviewNote: null,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DOCUMENT_RESUBMITTED',
        fromStatus: DocumentStatus.DENIED,
        toStatus: DocumentStatus.SUBMITTED,
      }),
      transaction,
    );
    expect(storage.delete).toHaveBeenCalledWith(oldObjectKey);
  });

  it('rejects attempts to update a document that is not denied', async () => {
    const { service, storage } = createService(DocumentStatus.SUBMITTED);

    await expect(
      service.updateDeniedDocument(userId, documentId, {}, replacementFile),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('does not expose a document owned by another technician', async () => {
    const { service } = createService(null);

    await expect(
      service.updateDeniedDocument(userId, documentId, {}, replacementFile),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
