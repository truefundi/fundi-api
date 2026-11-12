import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toCategoryResponse = <T extends { visitFee: number }>(category: T) => {
  const { visitFee, ...rest } = category;
  return { ...rest, bookingFee: visitFee };
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listActive() {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        keywords: true,
        visitFee: true,
        emergencyVisitFee: true,
        sosBookingFee: true,
        icon: true,
      },
    });
    return categories.map(toCategoryResponse);
  }

  // Returns categories available for new jobs and technician selections.
  async searchActive(name: string) {
    const query = name.trim();
    const categories = await this.prisma.serviceCategory.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { keywords: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        keywords: true,
        visitFee: true,
        emergencyVisitFee: true,
        sosBookingFee: true,
        icon: true,
      },
    });
    return categories.map(toCategoryResponse);
  }

  // Returns all categories, including inactive ones, to an administrator.
  async listAll() {
    const categories = await this.prisma.serviceCategory.findMany({
      orderBy: { name: 'asc' },
    });
    return categories.map(toCategoryResponse);
  }

  // Finds an active category by ID for public clients.
  async getActiveById(id: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        keywords: true,
        visitFee: true,
        emergencyVisitFee: true,
        sosBookingFee: true,
        icon: true,
      },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    return toCategoryResponse(category);
  }

  // Finds any category by ID for administrator management.
  async getById(id: string) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    return toCategoryResponse(category);
  }

  // Finds one category by exact name without case sensitivity.
  async getByName(name: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    return toCategoryResponse(category);
  }

  // Creates a category and its audit row in a single database transaction.
  async create(dto: CreateCategoryDto, actorId: string) {
    const name = dto.name.trim();
    const slug = slugify(name);
    if (!slug)
      throw new BadRequestException(
        'Category name must contain letters or numbers.',
      );
    this.assertBookingFees(dto.bookingFee, dto.sosBookingFee);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.create({
          data: {
            name,
            slug,
            description: dto.description?.trim() ?? '',
            category: dto.category?.trim() || 'Home Services',
            keywords: dto.keywords?.trim() ?? '',
            visitFee: dto.bookingFee ?? 0,
            emergencyVisitFee: dto.emergencyVisitFee ?? 0,
            isActive: dto.isActive ?? true,
            sosBookingFee: dto.sosBookingFee ?? null,
            icon: dto.icon?.trim() || null,
          },
        });
        await this.audit.log(
          {
            entityType: 'ServiceCategory',
            entityId: category.id,
            action: 'CREATED',
            actorId,
            metadata: {
              name,
              category: category.category,
              bookingFee: category.visitFee,
              emergencyVisitFee: category.emergencyVisitFee,
              sosBookingFee: category.sosBookingFee,
              icon: category.icon,
              keywords: category.keywords,
            },
          },
          tx,
        );
        return toCategoryResponse(category);
      });
    } catch (e) {
      this.rethrow(e);
    }
  }

  // Updates category data and records the change atomically.
  async update(id: string, dto: UpdateCategoryDto, actorId: string) {
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.keywords === undefined &&
      dto.category === undefined &&
      dto.bookingFee === undefined &&
      dto.emergencyVisitFee === undefined &&
      dto.isActive === undefined &&
      dto.sosBookingFee === undefined &&
      dto.icon === undefined
    ) {
      throw new BadRequestException(
        'Provide a category name, description, category, fee, or isActive value to update.',
      );
    }
    const name = dto.name?.trim();
    const slug = name === undefined ? undefined : slugify(name);
    if (name !== undefined && !slug) {
      throw new BadRequestException(
        'Category name must contain letters or numbers.',
      );
    }
    const description =
      dto.description === undefined ? undefined : dto.description.trim();
    const category =
      dto.category === undefined ? undefined : dto.category.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.serviceCategory.findUnique({
          where: { id },
          select: { visitFee: true, sosBookingFee: true },
        });
        if (!current)
          throw new NotFoundException('Service category not found.');
        this.assertBookingFees(
          dto.bookingFee ?? current.visitFee,
          dto.sosBookingFee ?? current.sosBookingFee,
        );
        const updated = await tx.serviceCategory.update({
          where: { id },
          data: {
            name,
            slug,
            description,
            category,
            keywords:
              dto.keywords === undefined ? undefined : dto.keywords.trim(),
            visitFee: dto.bookingFee,
            emergencyVisitFee: dto.emergencyVisitFee,
            isActive: dto.isActive,
            sosBookingFee: dto.sosBookingFee,
            icon: dto.icon === undefined ? undefined : dto.icon?.trim() || null,
          },
        });
        await this.audit.log(
          {
            entityType: 'ServiceCategory',
            entityId: id,
            action: 'UPDATED',
            actorId,
            metadata: {
              ...(name !== undefined ? { name } : {}),
              ...(description !== undefined ? { description } : {}),
              ...(dto.keywords !== undefined
                ? { keywords: dto.keywords.trim() }
                : {}),
              ...(category !== undefined ? { category } : {}),
              ...(dto.bookingFee !== undefined
                ? { bookingFee: dto.bookingFee }
                : {}),
              ...(dto.emergencyVisitFee !== undefined
                ? { emergencyVisitFee: dto.emergencyVisitFee }
                : {}),
              ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
              ...(dto.sosBookingFee !== undefined
                ? { sosBookingFee: dto.sosBookingFee }
                : {}),
              ...(dto.icon !== undefined
                ? { icon: dto.icon?.trim() || null }
                : {}),
            },
          },
          tx,
        );
        return toCategoryResponse(updated);
      });
    } catch (e) {
      this.rethrow(e);
    }
  }

  private assertBookingFees(
    bookingFee: number | null | undefined,
    sosBookingFee: number | null | undefined,
  ) {
    if (
      bookingFee !== null &&
      bookingFee !== undefined &&
      sosBookingFee !== null &&
      sosBookingFee !== undefined &&
      sosBookingFee <= bookingFee
    ) {
      throw new BadRequestException(
        'The SOS booking fee must be higher than the normal booking fee.',
      );
    }
  }

  // Deactivates instead of deleting so existing job/profile relations are preserved.
  async deactivate(id: string, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.update({
          where: { id },
          data: { isActive: false },
        });
        await this.audit.log(
          {
            entityType: 'ServiceCategory',
            entityId: id,
            action: 'DEACTIVATED',
            actorId,
            metadata: { isActive: false },
          },
          tx,
        );
        return {
          message: 'Service category deactivated.',
          category: toCategoryResponse(category),
        };
      });
    } catch (e) {
      this.rethrow(e);
    }
  }

  private rethrow(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002')
        throw new ConflictException('A category with this name already exists');
      if (e.code === 'P2025') throw new NotFoundException('Category not found');
    }
    throw e;
  }
}
