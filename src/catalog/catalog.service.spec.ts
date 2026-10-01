import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from './catalog.service';

// Tests public discovery and audited administrator category changes.
describe('CatalogService', () => {
  const category = {
    id: 'e5a4f4d7-0b21-46d8-9a4b-98765d332100',
    name: 'Plumbing',
    slug: 'plumbing',
    isActive: true,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
  };

  // Creates a service with transaction-aware Prisma and audit test doubles.
  const createService = () => {
    const transaction = {
      serviceCategory: {
        create: jest.fn().mockResolvedValue(category),
        update: jest.fn().mockResolvedValue(category),
      },
    };
    const prisma = {
      serviceCategory: {
        findMany: jest.fn().mockResolvedValue([category]),
        findFirst: jest.fn().mockResolvedValue(category),
        findUnique: jest.fn().mockResolvedValue(category),
      },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new CatalogService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
      ),
      prisma,
      transaction,
      audit,
    };
  };

  // Limits public listings and searches to active categories.
  it('lists active categories for public discovery', async () => {
    const { service, prisma } = createService();
    await service.listActive();
    expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
      }),
    );
  });

  // Returns all matching public categories for partial-name search.
  it('searches active category names case-insensitively', async () => {
    const { service, prisma } = createService();
    await service.searchActive('  PLUMB  ');
    expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          name: { contains: 'PLUMB', mode: 'insensitive' },
        },
      }),
    );
  });

  // Fails clearly when a public lookup targets an inactive or missing category.
  it('returns not found for a category unavailable to the public', async () => {
    const { service, prisma } = createService();
    prisma.serviceCategory.findFirst.mockResolvedValue(null);
    await expect(service.getActiveById(category.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // Trims names, derives slugs, and writes the audit entry in the same transaction.
  it('creates a normalized category and audit row', async () => {
    const { service, transaction, audit } = createService();
    await service.create({ name: '  Home Repair  ' }, 'admin-1');
    expect(transaction.serviceCategory.create).toHaveBeenCalledWith({
      data: { name: 'Home Repair', slug: 'home-repair' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ServiceCategory',
        action: 'CREATED',
        actorId: 'admin-1',
      }),
      transaction,
    );
  });

  // Rejects updates that do not change any category field.
  it('rejects an empty category update', async () => {
    const { service } = createService();
    await expect(
      service.update(category.id, {}, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Soft-deactivates categories to preserve existing profile/job references.
  it('deactivates a category and records the change', async () => {
    const { service, transaction, audit } = createService();
    await service.deactivate(category.id, 'admin-1');
    expect(transaction.serviceCategory.update).toHaveBeenCalledWith({
      where: { id: category.id },
      data: { isActive: false },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DEACTIVATED' }),
      transaction,
    );
  });
});
