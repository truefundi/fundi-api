import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Ad, AdAudience, AdBadge, AdPlacement } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AdsService } from './ads.service';
import { CreateAdDto } from './dto/ad.dto';

const PNG_BYTES = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
]);

const baseAd: Ad = {
  id: 'ad-1',
  productId: 3,
  title: 'Fundi Home Repair',
  description: 'Book a trusted technician.',
  imageUrl: null,
  imageKey: null,
  imageContentType: null,
  imageAlt: null,
  callToAction: null,
  badge: AdBadge.LIVE,
  placement: AdPlacement.LANDING_PRODUCT,
  audience: AdAudience.ALL,
  isActive: true,
  startsAt: null,
  endsAt: null,
  priority: 0,
  impressions: 0,
  clicks: 0,
  createdById: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('AdsService', () => {
  const createService = () => {
    const prisma: any = {
      ad: {
        create: jest.fn().mockResolvedValue(baseAd),
        findMany: jest.fn().mockResolvedValue([baseAd]),
        findUnique: jest.fn().mockResolvedValue(baseAd),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(baseAd),
        delete: jest.fn().mockResolvedValue(baseAd),
      },
      $transaction: jest.fn(async (input: unknown) =>
        Array.isArray(input) ? Promise.all(input) : (input as (tx: unknown) => unknown)(prisma),
      ),
    };
    const storage = {
      put: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(PNG_BYTES),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AdsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
      audit as unknown as AuditService,
    );
    return { service, prisma, storage, audit };
  };

  it('creates an ad with defaults and records the administrator', async () => {
    const { service, prisma, audit } = createService();
    const dto: CreateAdDto = {
      productId: 3,
      title: 'Fundi Home Repair',
      description: 'Book a trusted technician.',
    };

    await expect(service.create('admin-1', dto)).resolves.toMatchObject({
      id: baseAd.id,
      status: 'Live',
      isLive: true,
    });

    expect(prisma.ad.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'Fundi Home Repair',
        description: 'Book a trusted technician.',
        createdById: 'admin-1',
        badge: AdBadge.LIVE,
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AD_CREATED', actorId: 'admin-1' }),
    );
  });

  it('refuses a schedule that ends before it starts', async () => {
    const { service, prisma } = createService();

    await expect(
      service.create('admin-1', {
        title: 'Ad',
        description: 'Description',
        startsAt: '2026-12-02T00:00:00.000Z',
        endsAt: '2026-12-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ad.create).not.toHaveBeenCalled();
  });

  it('returns only active, in-window ads for the public listing', async () => {
    const { service, prisma } = createService();

    await service.listPublic({
      placement: AdPlacement.LANDING_PRODUCT,
      role: AdAudience.CUSTOMER,
    });

    const where = prisma.ad.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      isActive: true,
      placement: AdPlacement.LANDING_PRODUCT,
      audience: { in: [AdAudience.ALL, AdAudience.CUSTOMER] },
    });
    expect(where.AND).toEqual([
      { OR: [{ startsAt: null }, { startsAt: { lte: expect.any(Date) } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: expect.any(Date) } }] },
    ]);
  });

  it('rejects an update whose new schedule conflicts with the stored start', async () => {
    const { service, prisma } = createService();
    prisma.ad.findUnique.mockResolvedValue({
      ...baseAd,
      startsAt: new Date('2026-12-02T00:00:00.000Z'),
    });

    await expect(
      service.update('ad-1', 'admin-1', {
        endsAt: '2026-12-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.ad.update).not.toHaveBeenCalled();
  });

  it('increments a click counter and reports a missing ad', async () => {
    const { service, prisma } = createService();
    prisma.ad.update.mockResolvedValueOnce({
      id: 'ad-1',
      impressions: 0,
      clicks: 1,
    });
    await expect(service.recordClick('ad-1')).resolves.toEqual({
      id: 'ad-1',
      impressions: 0,
      clicks: 1,
    });
    expect(prisma.ad.update).toHaveBeenCalledWith({
      where: { id: 'ad-1' },
      data: { clicks: { increment: 1 } },
      select: { id: true, impressions: true, clicks: true },
    });

    prisma.ad.update.mockRejectedValueOnce({ code: 'P2025' });
    await expect(service.recordClick('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses bytes that are not JPEG, PNG, or WebP', async () => {
    const { service, storage } = createService();

    await expect(
      service.uploadImage('ad-1', 'admin-1', {
        buffer: Buffer.from('not an image'),
        originalname: 'fake.png',
        size: 11,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('stores a valid creative and removes the previous object', async () => {
    const { service, prisma, storage, audit } = createService();
    prisma.ad.findUnique.mockResolvedValue({
      ...baseAd,
      imageKey: 'ads/ad-1/old.png',
    });
    prisma.ad.update.mockResolvedValue({
      ...baseAd,
      imageKey: 'ads/ad-1/new.png',
      imageContentType: 'image/png',
    });

    const result = await service.uploadImage('ad-1', 'admin-1', {
      buffer: PNG_BYTES,
      originalname: 'creative.png',
      size: PNG_BYTES.length,
    });

    expect(storage.put).toHaveBeenCalledWith(
      expect.stringMatching(/^ads\/ad-1\/[0-9a-f-]+\.png$/),
      PNG_BYTES,
      'image/png',
    );
    expect(storage.delete).toHaveBeenCalledWith('ads/ad-1/old.png');
    expect(result.imageUrl).toBe('/api/v1/ads/ad-1/image');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AD_IMAGE_UPLOADED' }),
    );
  });

  it('deletes the stored creative with the ad', async () => {
    const { service, prisma, storage } = createService();
    prisma.ad.findUnique.mockResolvedValue({
      ...baseAd,
      imageKey: 'ads/ad-1/creative.png',
    });

    await service.remove('ad-1', 'admin-1');

    expect(prisma.ad.delete).toHaveBeenCalledWith({ where: { id: 'ad-1' } });
    expect(storage.delete).toHaveBeenCalledWith('ads/ad-1/creative.png');
  });
});
