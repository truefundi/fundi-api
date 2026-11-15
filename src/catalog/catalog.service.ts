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
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const SERVICE_SELECT = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  keywords: true,
  visitFee: true,
  emergencyVisitFee: true,
  sosBookingFee: true,
  icon: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ServiceCategorySelect;

const toServiceResponse = <T extends { visitFee: number }>(service: T) => {
  const { visitFee, ...rest } = service;
  return { ...rest, bookingFee: visitFee };
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listCategories() {
    return this.prisma.catalogCategory.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async searchCategories(name: string) {
    return this.prisma.catalogCategory.findMany({
      where: {
        isActive: true,
        name: { contains: name.trim(), mode: 'insensitive' },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getActiveCategoryById(id: string) {
    const category = await this.prisma.catalogCategory.findFirst({
      where: { id, isActive: true },
    });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  async listAllCategories() {
    return this.prisma.catalogCategory.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getCategoryById(id: string) {
    const category = await this.prisma.catalogCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  async getCategoryByName(name: string) {
    const category = await this.prisma.catalogCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
    });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  async createCategory(dto: CreateCategoryDto, actorId: string) {
    const name = dto.name.trim();
    const description = dto.description.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.catalogCategory.create({
          data: { name, description },
        });
        await this.audit.log(
          {
            entityType: 'CatalogCategory',
            entityId: category.id,
            action: 'CREATED',
            actorId,
            metadata: { name, description },
          },
          tx,
        );
        return category;
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actorId: string) {
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.isActive === undefined
    ) {
      throw new BadRequestException(
        'Provide a category name, description, or isActive value to update.',
      );
    }
    const name = dto.name?.trim();
    const description = dto.description?.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.catalogCategory.update({
          where: { id },
          data: { name, description, isActive: dto.isActive },
        });
        await this.audit.log(
          {
            entityType: 'CatalogCategory',
            entityId: id,
            action: 'UPDATED',
            actorId,
            metadata: {
              ...(name !== undefined ? { name } : {}),
              ...(description !== undefined ? { description } : {}),
              ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            },
          },
          tx,
        );
        return updated;
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async deactivateCategory(id: string, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const category = await tx.catalogCategory.update({
          where: { id },
          data: { isActive: false },
        });
        await this.audit.log(
          {
            entityType: 'CatalogCategory',
            entityId: id,
            action: 'DEACTIVATED',
            actorId,
            metadata: { isActive: false },
          },
          tx,
        );
        return { message: 'Category deactivated.', category };
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async listActiveServices() {
    const services = await this.prisma.serviceCategory.findMany({
      where: { isActive: true, category: { isActive: true } },
      orderBy: { name: 'asc' },
      select: SERVICE_SELECT,
    });
    return services.map(toServiceResponse);
  }

  async searchActiveServices(name: string) {
    const query = name.trim();
    const services = await this.prisma.serviceCategory.findMany({
      where: {
        isActive: true,
        category: { isActive: true },
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { keywords: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { name: 'asc' },
      select: SERVICE_SELECT,
    });
    return services.map(toServiceResponse);
  }

  async getActiveServiceById(id: string) {
    const service = await this.prisma.serviceCategory.findFirst({
      where: { id, isActive: true, category: { isActive: true } },
      select: SERVICE_SELECT,
    });
    if (!service) throw new NotFoundException('Service not found.');
    return toServiceResponse(service);
  }

  async listAllServices() {
    const services = await this.prisma.serviceCategory.findMany({
      orderBy: { name: 'asc' },
      select: SERVICE_SELECT,
    });
    return services.map(toServiceResponse);
  }

  async getServiceById(id: string) {
    const service = await this.prisma.serviceCategory.findUnique({
      where: { id },
      select: SERVICE_SELECT,
    });
    if (!service) throw new NotFoundException('Service not found.');
    return toServiceResponse(service);
  }

  async getServiceByName(name: string) {
    const service = await this.prisma.serviceCategory.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' } },
      select: SERVICE_SELECT,
    });
    if (!service) throw new NotFoundException('Service not found.');
    return toServiceResponse(service);
  }

  async createService(dto: CreateServiceDto, actorId: string) {
    const name = dto.name.trim();
    const slug = slugify(name);
    if (!slug) {
      throw new BadRequestException(
        'Service name must contain letters or numbers.',
      );
    }
    this.assertBookingFees(dto.bookingFee, dto.sosBookingFee);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertActiveCategory(tx, dto.categoryId);
        const service = await tx.serviceCategory.create({
          data: {
            name,
            slug,
            categoryId: dto.categoryId,
            description: dto.description?.trim() ?? '',
            keywords: dto.keywords?.trim() ?? '',
            visitFee: dto.bookingFee ?? 0,
            emergencyVisitFee: dto.emergencyVisitFee ?? 0,
            isActive: dto.isActive ?? true,
            sosBookingFee: dto.sosBookingFee ?? null,
            icon: dto.icon?.trim() || null,
          },
          select: SERVICE_SELECT,
        });
        await this.audit.log(
          {
            entityType: 'ServiceCategory',
            entityId: service.id,
            action: 'CREATED',
            actorId,
            metadata: {
              name,
              categoryId: service.categoryId,
              bookingFee: service.visitFee,
              emergencyVisitFee: service.emergencyVisitFee,
              sosBookingFee: service.sosBookingFee,
              icon: service.icon,
              keywords: service.keywords,
            },
          },
          tx,
        );
        return toServiceResponse(service);
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async updateService(id: string, dto: UpdateServiceDto, actorId: string) {
    if (
      dto.name === undefined &&
      dto.categoryId === undefined &&
      dto.description === undefined &&
      dto.keywords === undefined &&
      dto.bookingFee === undefined &&
      dto.emergencyVisitFee === undefined &&
      dto.isActive === undefined &&
      dto.sosBookingFee === undefined &&
      dto.icon === undefined
    ) {
      throw new BadRequestException('Provide a service field to update.');
    }
    const name = dto.name?.trim();
    const slug = name === undefined ? undefined : slugify(name);
    if (name !== undefined && !slug) {
      throw new BadRequestException(
        'Service name must contain letters or numbers.',
      );
    }
    const description =
      dto.description === undefined ? undefined : dto.description.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.serviceCategory.findUnique({
          where: { id },
          select: { visitFee: true, sosBookingFee: true },
        });
        if (!current) throw new NotFoundException('Service not found.');
        this.assertBookingFees(
          dto.bookingFee ?? current.visitFee,
          dto.sosBookingFee === undefined
            ? current.sosBookingFee
            : dto.sosBookingFee,
        );
        if (dto.categoryId !== undefined) {
          await this.assertActiveCategory(tx, dto.categoryId);
        }
        const updated = await tx.serviceCategory.update({
          where: { id },
          data: {
            name,
            slug,
            categoryId: dto.categoryId,
            description,
            keywords:
              dto.keywords === undefined ? undefined : dto.keywords.trim(),
            visitFee: dto.bookingFee,
            emergencyVisitFee: dto.emergencyVisitFee,
            isActive: dto.isActive,
            sosBookingFee: dto.sosBookingFee,
            icon: dto.icon === undefined ? undefined : dto.icon?.trim() || null,
          },
          select: SERVICE_SELECT,
        });
        await this.audit.log(
          {
            entityType: 'ServiceCategory',
            entityId: id,
            action: 'UPDATED',
            actorId,
            metadata: {
              ...(name !== undefined ? { name } : {}),
              ...(dto.categoryId !== undefined
                ? { categoryId: dto.categoryId }
                : {}),
              ...(description !== undefined ? { description } : {}),
              ...(dto.keywords !== undefined
                ? { keywords: dto.keywords.trim() }
                : {}),
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
        return toServiceResponse(updated);
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async deactivateService(id: string, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const service = await tx.serviceCategory.update({
          where: { id },
          data: { isActive: false },
          select: SERVICE_SELECT,
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
          message: 'Service deactivated.',
          service: toServiceResponse(service),
        };
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  private async assertActiveCategory(
    tx: Prisma.TransactionClient,
    categoryId: string,
  ) {
    const category = await tx.catalogCategory.findFirst({
      where: { id: categoryId, isActive: true },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException(
        'The selected category does not exist or is inactive.',
      );
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

  private rethrow(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          'A category or service with this name already exists.',
        );
      }
      if (error.code === 'P2025') {
        throw new NotFoundException(
          'The requested catalog record was not found.',
        );
      }
    }
    throw error;
  }
}
