import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Ad, AdAudience, AdBadge, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  detectFileType,
  IMAGE_MIME_TYPES,
  MAX_UPLOAD_BYTES,
  UploadedFileData,
} from '../technicians/documents/file.util';
import { AdResponseDto } from './dto/ad-response.dto';
import {
  CreateAdDto,
  ListAdsQueryDto,
  PublicAdsQueryDto,
  UpdateAdDto,
} from './dto/ad.dto';

// Ads are public, so a malformed or oversized upload must be refused before it is
// stored. Multer enforces the same limit; this is the second line of defence.
const MAX_AD_IMAGE_BYTES = MAX_UPLOAD_BYTES;

@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ── Public surface ────────────────────────────────────────────────────────

  // Returns only ads a visitor may see right now. Scheduling and the manual switch
  // are both applied here so no caller has to re-implement the rule.
  async listPublic(query: PublicAdsQueryDto): Promise<AdResponseDto[]> {
    const now = new Date();
    const where: Prisma.AdWhereInput = {
      isActive: true,
      ...(query.placement ? { placement: query.placement } : {}),
      ...(query.role
        ? { audience: { in: [AdAudience.ALL, query.role] } }
        : {}),
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    };
    const ads = await this.prisma.ad.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    return ads.map((ad) => this.toResponse(ad));
  }

  // Streams the stored creative. A public route, because the landing page has no
  // session; the key is an unguessable UUID and the bytes are not sensitive.
  async readImage(id: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found.');
    if (!ad.imageKey) throw new NotFoundException('This ad has no uploaded image.');
    return {
      buffer: await this.storage.get(ad.imageKey),
      mimeType: ad.imageContentType ?? 'application/octet-stream',
    };
  }

  // Counters are best-effort analytics: a missing row is reported, nothing else.
  async recordImpression(id: string) {
    return this.increment(id, 'impressions');
  }

  async recordClick(id: string) {
    return this.increment(id, 'clicks');
  }

  // ── Admin surface ─────────────────────────────────────────────────────────

  async listAdmin(query: ListAdsQueryDto) {
    const where: Prisma.AdWhereInput = {
      ...(query.placement ? { placement: query.placement } : {}),
      ...(query.audience ? { audience: query.audience } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ad.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: query.limit ?? 100,
        skip: query.offset ?? 0,
      }),
      this.prisma.ad.count({ where }),
    ]);
    return {
      items: items.map((ad) => this.toResponse(ad)),
      total,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
    };
  }

  async getAdmin(id: string) {
    return this.toResponse(await this.requireAd(id));
  }

  async create(adminId: string, dto: CreateAdDto) {
    const { start, end } = this.resolveWindow(dto.startsAt, dto.endsAt);
    const ad = await this.prisma.ad.create({
      data: {
        productId: dto.productId ?? null,
        title: dto.title,
        description: dto.description,
        imageUrl: dto.imageUrl ?? null,
        imageAlt: dto.imageAlt ?? null,
        callToAction: dto.callToAction ?? null,
        badge: dto.badge ?? AdBadge.LIVE,
        placement: dto.placement ?? undefined,
        audience: dto.audience ?? undefined,
        isActive: dto.isActive ?? true,
        startsAt: start ?? null,
        endsAt: end ?? null,
        priority: dto.priority ?? 0,
        createdById: adminId,
      },
    });
    await this.audit.log({
      entityType: 'Ad',
      entityId: ad.id,
      action: 'AD_CREATED',
      actorId: adminId,
      metadata: { placement: ad.placement, audience: ad.audience },
    });
    return this.toResponse(ad);
  }

  async update(id: string, adminId: string, dto: UpdateAdDto) {
    const existing = await this.requireAd(id);
    const { start, end } = this.resolveWindow(
      dto.startsAt !== undefined ? dto.startsAt : existing.startsAt,
      dto.endsAt !== undefined ? dto.endsAt : existing.endsAt,
    );
    const ad = await this.prisma.ad.update({
      where: { id },
      data: {
        ...(dto.productId !== undefined ? { productId: dto.productId } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.imageAlt !== undefined ? { imageAlt: dto.imageAlt } : {}),
        ...(dto.callToAction !== undefined ? { callToAction: dto.callToAction } : {}),
        ...(dto.badge !== undefined ? { badge: dto.badge } : {}),
        ...(dto.placement !== undefined ? { placement: dto.placement } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.startsAt !== undefined ? { startsAt: start ?? null } : {}),
        ...(dto.endsAt !== undefined ? { endsAt: end ?? null } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      },
    });
    await this.audit.log({
      entityType: 'Ad',
      entityId: ad.id,
      action: 'AD_UPDATED',
      actorId: adminId,
      metadata: { isActive: ad.isActive, placement: ad.placement },
    });
    return this.toResponse(ad);
  }

  async remove(id: string, adminId: string) {
    const ad = await this.requireAd(id);
    await this.prisma.ad.delete({ where: { id } });
    if (ad.imageKey) await this.deleteQuietly(ad.imageKey);
    await this.audit.log({
      entityType: 'Ad',
      entityId: ad.id,
      action: 'AD_DELETED',
      actorId: adminId,
      metadata: { title: ad.title },
    });
    return { message: 'Ad deleted.' };
  }

  async uploadImage(id: string, adminId: string, file?: UploadedFileData) {
    const ad = await this.requireAd(id);
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Attach an image in the `file` field.');
    }
    if (file.size > MAX_AD_IMAGE_BYTES) {
      throw new BadRequestException('Ad images must be 5 MiB or smaller.');
    }
    const detected = detectFileType(file.buffer);
    if (!detected || !(IMAGE_MIME_TYPES as readonly string[]).includes(detected.mime)) {
      throw new BadRequestException('Ad images must be JPEG, PNG, or WebP.');
    }

    const objectKey = `ads/${ad.id}/${randomUUID()}.${detected.extension}`;
    await this.storage.put(objectKey, file.buffer, detected.mime);
    let updated: Ad;
    try {
      updated = await this.prisma.ad.update({
        where: { id },
        // An uploaded file wins over an old external URL, so clear it.
        data: { imageKey: objectKey, imageContentType: detected.mime, imageUrl: null },
      });
    } catch (error) {
      await this.deleteQuietly(objectKey);
      throw error;
    }
    if (ad.imageKey && ad.imageKey !== objectKey) {
      await this.deleteQuietly(ad.imageKey);
    }
    await this.audit.log({
      entityType: 'Ad',
      entityId: ad.id,
      action: 'AD_IMAGE_UPLOADED',
      actorId: adminId,
      metadata: { mimeType: detected.mime, sizeBytes: file.size },
    });
    return this.toResponse(updated);
  }

  async removeImage(id: string, adminId: string) {
    const ad = await this.requireAd(id);
    if (!ad.imageKey) throw new NotFoundException('This ad has no uploaded image.');
    await this.prisma.ad.update({
      where: { id },
      data: { imageKey: null, imageContentType: null },
    });
    await this.deleteQuietly(ad.imageKey);
    await this.audit.log({
      entityType: 'Ad',
      entityId: ad.id,
      action: 'AD_IMAGE_DELETED',
      actorId: adminId,
    });
    return { message: 'Ad image removed.' };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async requireAd(id: string): Promise<Ad> {
    const ad = await this.prisma.ad.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException('Ad not found.');
    return ad;
  }

  private async increment(id: string, field: 'impressions' | 'clicks') {
    const data: Prisma.AdUpdateInput =
      field === 'impressions'
        ? { impressions: { increment: 1 } }
        : { clicks: { increment: 1 } };
    try {
      const ad = await this.prisma.ad.update({
        where: { id },
        data,
        select: { id: true, impressions: true, clicks: true },
      });
      return ad;
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
        throw new NotFoundException('Ad not found.');
      }
      throw error;
    }
  }

  // Validates a scheduling window. Accepts strings from DTOs and Dates from rows.
  private resolveWindow(
    startsAt: string | Date | null | undefined,
    endsAt: string | Date | null | undefined,
  ): { start: Date | null; end: Date | null } {
    const start = this.toDate(startsAt);
    const end = this.toDate(endsAt);
    if (start && end && end.getTime() <= start.getTime()) {
      throw new BadRequestException('`endsAt` must be after `startsAt`.');
    }
    return { start, end };
  }

  private toDate(value: string | Date | null | undefined): Date | null {
    if (value === null || value === undefined) return null;
    return value instanceof Date ? value : new Date(value);
  }

  private toResponse(ad: Ad): AdResponseDto {
    const now = Date.now();
    const isLive =
      ad.isActive &&
      (!ad.startsAt || ad.startsAt.getTime() <= now) &&
      (!ad.endsAt || ad.endsAt.getTime() >= now);
    return {
      id: ad.id,
      productId: ad.productId,
      title: ad.title,
      description: ad.description,
      imageUrl:
        ad.imageUrl ?? (ad.imageKey ? `/api/v1/ads/${ad.id}/image` : null),
      imageAlt: ad.imageAlt,
      callToAction: ad.callToAction,
      badge: ad.badge,
      status: ad.badge === AdBadge.LIVE ? 'Live' : 'Coming soon',
      placement: ad.placement,
      audience: ad.audience,
      isActive: ad.isActive,
      isLive,
      startsAt: ad.startsAt,
      endsAt: ad.endsAt,
      priority: ad.priority,
      impressions: ad.impressions,
      clicks: ad.clicks,
      createdAt: ad.createdAt,
      updatedAt: ad.updatedAt,
    };
  }

  private async deleteQuietly(objectKey: string) {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      this.logger.warn(
        `Could not delete stored ad image ${objectKey}: ${(error as Error).message}`,
      );
    }
  }
}
