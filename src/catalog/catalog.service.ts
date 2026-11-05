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

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listActive() {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        visitFee: true,
        emergencyVisitFee: true,
        sosBookingFee: true,
        icon: true,
      },
    });
  }

  // Returns categories available for new jobs and technician selections.
  searchActive(name: string) {
    return this.prisma.serviceCategory.findMany({
      where: {
        isActive: true,
        name: { contains: name.trim(), mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        category: true,
        visitFee: true,
        emergencyVisitFee: true,
        sosBookingFee: true,
        icon: true,
      },
    });
  }

  // Returns all categories, including inactive ones, to an administrator.
  listAll() {
    return this.prisma.serviceCategory.findMany({ orderBy: { name: 'asc' } });
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
        visitFee: true,
        emergencyVisitFee: true,
        sosBookingFee: true,
        icon: true,
      },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    return category;
  }

  // Finds any category by ID for administrator management.
  async getById(id: string) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    return category;
  }

  // Finds one category by exact name without case sensitivity.
  async getByName(name: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (!category) throw new NotFoundException('Service category not found.');
    return category;
  }

  // Creates a category and its audit row in a single database transaction.
  async create(dto: CreateCategoryDto, actorId: string) {
    const name = dto.name.trim();
    const slug = slugify(name);
    if (!slug)
      throw new BadRequestException(
        'Category name must contain letters or numbers.',
      );
    this.assertBookingFees(dto.visitFee, dto.sosBookingFee);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.create({
          data: {
            name,
            slug,
            description: dto.description?.trim() ?? '',
            category: dto.category?.trim() || 'Home Services',
            visitFee: dto.visitFee ?? 0,
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
              visitFee: category.visitFee,
              emergencyVisitFee: category.emergencyVisitFee,
              sosBookingFee: category.sosBookingFee,
              icon: category.icon,
            },
          },
          tx,
        );
        return category;
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
      dto.category === undefined &&
      dto.visitFee === undefined &&
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
          dto.visitFee ?? current.visitFee,
          dto.sosBookingFee ?? current.sosBookingFee,
        );
        const updated = await tx.serviceCategory.update({
          where: { id },
          data: {
            name,
            slug,
            description,
            category,
            visitFee: dto.visitFee,
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
              ...(category !== undefined ? { category } : {}),
              ...(dto.visitFee !== undefined ? { visitFee: dto.visitFee } : {}),
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
        return updated;
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
        return { message: 'Service category deactivated.', category };
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
