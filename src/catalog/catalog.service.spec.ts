import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CatalogService } from './catalog.service';
import { ServiceChargePayer, ServiceChargeType } from '@prisma/client';

describe('CatalogService', () => {
  const category = {
    id: '84cfa9af-05d4-40c1-ad36-123e412ec509',
    name: 'Home Services',
    description: 'Repairs and maintenance for homes.',
    isActive: true,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
  };
  const serviceRecord = {
    id: 'e5a4f4d7-0b21-46d8-9a4b-98765d332100',
    categoryId: category.id,
    name: 'Plumbing',
    slug: 'plumbing',
    description: 'Leak repairs, pipe fitting, and drain unblocking.',
    keywords: 'leak repair, pipes',
    visitFee: 1000,
    emergencyVisitFee: 1500,
    sosBookingFee: 2500,
    icon: 'wrench',
    isActive: true,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    category,
  };
  const serviceCharge = {
    id: 'charge-1',
    serviceCategoryId: serviceRecord.id,
    name: 'Tax',
    description: null,
    chargeType: ServiceChargeType.PERCENTAGE,
    value: 10,
    payer: ServiceChargePayer.CUSTOMER,
    sortOrder: 0,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };

  const createService = () => {
    const transaction = {
      catalogCategory: {
        create: jest.fn().mockResolvedValue(category),
        update: jest.fn().mockResolvedValue(category),
        findUnique: jest.fn().mockResolvedValue(category),
        findFirst: jest.fn().mockResolvedValue(category),
      },
      serviceCategory: {
        create: jest.fn().mockResolvedValue(serviceRecord),
        update: jest.fn().mockResolvedValue(serviceRecord),
        findUnique: jest.fn().mockResolvedValue(serviceRecord),
      },
      serviceCharge: {
        findMany: jest.fn().mockResolvedValue([serviceCharge]),
        create: jest.fn().mockResolvedValue(serviceCharge),
        findFirst: jest.fn().mockResolvedValue(serviceCharge),
        update: jest.fn().mockResolvedValue(serviceCharge),
        delete: jest.fn().mockResolvedValue(serviceCharge),
      },
    };
    const prisma = {
      catalogCategory: {
        findMany: jest.fn().mockResolvedValue([category]),
        findFirst: jest.fn().mockResolvedValue(category),
        findUnique: jest.fn().mockResolvedValue(category),
      },
      serviceCategory: {
        findMany: jest.fn().mockResolvedValue([serviceRecord]),
        findFirst: jest.fn().mockResolvedValue(serviceRecord),
        findUnique: jest.fn().mockResolvedValue(serviceRecord),
      },
      serviceCharge: {
        findMany: jest.fn().mockResolvedValue([serviceCharge]),
        create: jest.fn().mockResolvedValue(serviceCharge),
        findFirst: jest.fn().mockResolvedValue(serviceCharge),
        update: jest.fn().mockResolvedValue(serviceCharge),
        delete: jest.fn().mockResolvedValue(serviceCharge),
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

  it('lists only active categories', async () => {
    const { service, prisma } = createService();
    await service.listCategories();

    expect(prisma.catalogCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('creates a parent category with an audit record', async () => {
    const { service, transaction, audit } = createService();
    await service.createCategory(
      {
        name: '  Home Services ',
        description: '  Repairs and maintenance for homes. ',
      },
      'admin-1',
    );

    expect(transaction.catalogCategory.create).toHaveBeenCalledWith({
      data: {
        name: 'Home Services',
        description: 'Repairs and maintenance for homes.',
      },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'CatalogCategory',
        action: 'CREATED',
        actorId: 'admin-1',
      }),
      transaction,
    );
  });

  it('rejects empty category updates', async () => {
    const { service } = createService();
    await expect(
      service.updateCategory(category.id, {}, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('searches services by name and keywords within active categories', async () => {
    const { service, prisma } = createService();
    const [result] = await service.searchActiveServices('  PIPES  ');

    expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          category: { isActive: true },
          OR: [
            { name: { contains: 'PIPES', mode: 'insensitive' } },
            { keywords: { contains: 'PIPES', mode: 'insensitive' } },
          ],
        },
      }),
    );
    expect(result).toMatchObject({
      id: serviceRecord.id,
      categoryId: category.id,
      category: {
        id: category.id,
        name: 'Home Services',
        description: category.description,
      },
      bookingFee: 1000,
      keywords: 'leak repair, pipes',
    });
    expect(result).not.toHaveProperty('visitFee');
  });

  it('lists what a customer pays to book, without exposing the charges', async () => {
    const { service, prisma } = createService();
    prisma.serviceCategory.findMany.mockResolvedValueOnce([
      {
        ...serviceRecord,
        serviceCharges: [
          serviceCharge,
          {
            ...serviceCharge,
            id: 'charge-2',
            name: 'Platform fee',
            chargeType: ServiceChargeType.FIXED,
            value: 300,
            sortOrder: 1,
          },
          {
            ...serviceCharge,
            id: 'charge-3',
            name: 'Commission',
            chargeType: ServiceChargeType.FIXED,
            value: 200,
            payer: ServiceChargePayer.FUNDI,
            sortOrder: 2,
          },
        ],
      },
    ]);

    const [result] = await service.listActiveServices();

    expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          serviceCharges: expect.anything(),
        }),
      }),
    );
    // 1000 + 10% + 300 (the FUNDI charge is not the customer's); SOS: 2500 + 250 + 300.
    expect(result).toMatchObject({
      bookingFee: 1000,
      customerBookingFee: 1400,
      sosBookingFee: 2500,
      customerSosBookingFee: 3050,
    });
    expect(result).not.toHaveProperty('serviceCharges');
  });

  it('gives no customer SOS total when the service has no SOS fee', async () => {
    const { service, prisma } = createService();
    prisma.serviceCategory.findMany.mockResolvedValueOnce([
      { ...serviceRecord, sosBookingFee: null, serviceCharges: [] },
    ]);

    const [result] = await service.listActiveServices();

    expect(result).toMatchObject({
      customerBookingFee: 1000,
      customerSosBookingFee: null,
    });
  });

  it('gets services with their complete parent category', async () => {
    const { service, prisma } = createService();
    const result = await service.getActiveServiceById(serviceRecord.id);

    expect(prisma.serviceCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: serviceRecord.id,
          isActive: true,
          category: { isActive: true },
        },
        select: expect.objectContaining({
          category: {
            select: expect.objectContaining({
              id: true,
              name: true,
              description: true,
            }),
          },
        }),
      }),
    );
    expect(result.category).toEqual(category);
  });

  it('creates a service linked to an active category', async () => {
    const { service, transaction, audit } = createService();
    await service.createService(
      {
        name: '  Pipe Repair ',
        categoryId: category.id,
        keywords: '  drain, leaks ',
        bookingFee: 1000,
      },
      'admin-1',
    );

    expect(transaction.catalogCategory.findFirst).toHaveBeenCalledWith({
      where: { id: category.id, isActive: true },
      select: { id: true },
    });
    expect(transaction.serviceCategory.create).toHaveBeenCalledWith({
      data: {
        name: 'Pipe Repair',
        slug: 'pipe-repair',
        categoryId: category.id,
        description: '',
        keywords: 'drain, leaks',
        visitFee: 1000,
        emergencyVisitFee: 0,
        isActive: true,
        sosBookingFee: null,
        icon: null,
      },
      select: expect.any(Object),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ServiceCategory',
        action: 'CREATED',
        actorId: 'admin-1',
        metadata: expect.objectContaining({ categoryId: category.id }),
      }),
      transaction,
    );
  });

  it('rejects services linked to a missing or inactive category', async () => {
    const { service, transaction } = createService();
    transaction.catalogCategory.findFirst.mockResolvedValue(null);

    await expect(
      service.createService(
        { name: 'Pipe Repair', categoryId: category.id },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.serviceCategory.create).not.toHaveBeenCalled();
  });

  it('requires an SOS fee higher than the normal service fee', async () => {
    const { service, transaction } = createService();
    await expect(
      service.createService(
        {
          name: 'Emergency Plumbing',
          categoryId: category.id,
          bookingFee: 1000,
          sosBookingFee: 1000,
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.serviceCategory.create).not.toHaveBeenCalled();
  });

  it('updates the service category relationship', async () => {
    const { service, transaction } = createService();
    await service.updateService(
      serviceRecord.id,
      { categoryId: category.id },
      'admin-1',
    );

    expect(transaction.serviceCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: serviceRecord.id },
        data: expect.objectContaining({ categoryId: category.id }),
        select: expect.any(Object),
      }),
    );
  });

  it('creates an audited percentage charge for a service', async () => {
    const { service, transaction, audit } = createService();
    await service.createServiceCharge(
      serviceRecord.id,
      {
        name: ' Tax ',
        chargeType: ServiceChargeType.PERCENTAGE,
        value: 10,
        payer: ServiceChargePayer.CUSTOMER,
      },
      'admin-1',
    );

    expect(transaction.serviceCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceCategoryId: serviceRecord.id,
        name: 'Tax',
        chargeType: ServiceChargeType.PERCENTAGE,
        value: 10,
        payer: ServiceChargePayer.CUSTOMER,
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'ServiceCharge',
        action: 'CREATED',
        actorId: 'admin-1',
      }),
      transaction,
    );
  });

  it('rejects percentage charges above 100 percent', async () => {
    const { service, transaction } = createService();
    await expect(
      service.createServiceCharge(
        serviceRecord.id,
        {
          name: 'Invalid percentage',
          chargeType: ServiceChargeType.PERCENTAGE,
          value: 100.01,
          payer: ServiceChargePayer.FUNDI,
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.serviceCharge.create).not.toHaveBeenCalled();
  });

  it('rejects deleting a charge that is not attached to the service', async () => {
    const { service, transaction } = createService();
    transaction.serviceCharge.findFirst.mockResolvedValue(null);
    await expect(
      service.deleteServiceCharge(serviceRecord.id, 'other-charge', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction.serviceCharge.delete).not.toHaveBeenCalled();
  });

  it('allows clearing the SOS fee when increasing the normal fee', async () => {
    const { service, transaction } = createService();
    await service.updateService(
      serviceRecord.id,
      { bookingFee: 3000, sosBookingFee: null },
      'admin-1',
    );

    expect(transaction.serviceCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visitFee: 3000,
          sosBookingFee: null,
        }),
      }),
    );
  });

  it('returns not found for a service unavailable to the public', async () => {
    const { service, prisma } = createService();
    prisma.serviceCategory.findFirst.mockResolvedValue(null);
    await expect(
      service.getActiveServiceById(serviceRecord.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deactivates categories and services without deleting their records', async () => {
    const { service, transaction } = createService();
    await service.deactivateCategory(category.id, 'admin-1');
    await service.deactivateService(serviceRecord.id, 'admin-1');

    expect(transaction.catalogCategory.update).toHaveBeenCalledWith({
      where: { id: category.id },
      data: { isActive: false },
    });
    expect(transaction.serviceCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: serviceRecord.id },
        data: { isActive: false },
      }),
    );
  });
});
