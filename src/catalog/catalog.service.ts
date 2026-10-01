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
      select: { id: true, name: true, slug: true },
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
      select: { id: true, name: true, slug: true },
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
      select: { id: true, name: true, slug: true },
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
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.create({
          data: { name, slug },
        });
        await this.audit.log(
          {
            entityType: 'ServiceCategory',
            entityId: category.id,
            action: 'CREATED',
            actorId,
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
    if (dto.name === undefined && dto.isActive === undefined) {
      throw new BadRequestException(
        'Provide a category name or isActive value to update.',
      );
    }
    const name = dto.name?.trim();
    const slug = name === undefined ? undefined : slugify(name);
    if (name !== undefined && !slug) {
      throw new BadRequestException(
        'Category name must contain letters or numbers.',
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.serviceCategory.update({
          where: { id },
          data: { name, slug, isActive: dto.isActive },
        });
        await this.audit.log(
          {
            entityType: 'ServiceCategory',
            entityId: id,
            action: 'UPDATED',
            actorId,
            metadata: {
              ...(name !== undefined ? { name } : {}),
              ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
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
