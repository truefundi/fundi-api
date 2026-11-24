import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DocumentType,
  NotificationType,
  Prisma,
  VerificationStatus,
} from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
} from '../../common/dto/pagination.constants';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TechniciansService } from '../technicians.service';
import {
  AddTechnicianServiceDto,
  ListTechnicianServicesQueryDto,
  ReviewTechnicianServiceDto,
  UpdateTechnicianServiceDto,
} from './dto/technician-service.dto';

/** A technician lists at most this many services. */
const MAX_SERVICES = 10;

const SERVICE_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.TechnicianCategoryInclude;

type ServiceRow = Prisma.TechnicianCategoryGetPayload<{
  include: typeof SERVICE_INCLUDE;
}>;

/**
 * Services a technician offers are reviewed one at a time. An approved
 * technician applies for another service; it gets jobs only once an admin
 * approves it. Before the first approval, services go with the application.
 */
@Injectable()
export class TechnicianServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly technicians: TechniciansService,
  ) {}

  // ─── Technician ─────────────────────────────────────────────────────────

  async listMine(userId: string) {
    const profile = await this.requireProfile(userId);
    const rows = await this.prisma.technicianCategory.findMany({
      where: { technicianId: profile.id },
      include: SERVICE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toResponse(row));
  }

  async add(userId: string, dto: AddTechnicianServiceDto) {
    const profile = await this.requireProfile(userId);
    if (profile.verificationStatus !== VerificationStatus.APPROVED) {
      throw new ConflictException(
        'Your application is still being reviewed: list services in the application itself.',
      );
    }
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "technician_profiles" WHERE "id" = ${profile.id} FOR UPDATE`;
      const [item] = await this.technicians.linkCatalogNames(tx, [dto]);
      const existing = await tx.technicianCategory.findMany({
        where: { technicianId: profile.id },
        select: { categoryId: true, customNameNormalized: true },
      });
      if (existing.length >= MAX_SERVICES) {
        throw new BadRequestException(
          `A technician can list at most ${MAX_SERVICES} services.`,
        );
      }
      const customName = item.categoryId ? null : item.customName!.trim();
      const normalized = customName?.toLowerCase() ?? '';
      const duplicate = existing.some((row) =>
        item.categoryId
          ? row.categoryId === item.categoryId
          : !row.categoryId && row.customNameNormalized === normalized,
      );
      if (duplicate) {
        throw new ConflictException('You already list this service.');
      }
      if (item.categoryId) {
        const category = await tx.serviceCategory.findFirst({
          where: { id: item.categoryId, isActive: true },
          select: { id: true },
        });
        if (!category) {
          throw new BadRequestException(
            'This service is not offered on Fundi.',
          );
        }
      }
      const row = await tx.technicianCategory.create({
        data: {
          technicianId: profile.id,
          categoryId: item.categoryId ?? null,
          customName,
          customNameNormalized: normalized,
          yearsOfExperience: item.yearsOfExperience,
          status: VerificationStatus.PENDING,
        },
        include: SERVICE_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'TechnicianService',
          entityId: row.id,
          action: 'SERVICE_REQUESTED',
          toStatus: VerificationStatus.PENDING,
          actorId: userId,
          metadata: {
            technicianId: profile.id,
            service: row.category?.name ?? row.customName,
          },
        },
        tx,
      );
      return row;
    });
    return this.toResponse(created);
  }

  /** Years for a pending service; a rejected one goes back to review. */
  async update(
    userId: string,
    serviceId: string,
    dto: UpdateTechnicianServiceDto,
  ) {
    const profile = await this.requireProfile(userId);
    const row = await this.requireOwnService(profile.id, serviceId);
    if (row.status === VerificationStatus.APPROVED) {
      throw new ConflictException(
        'This service is approved. Contact Fundi support to change it.',
      );
    }
    const resubmit = row.status === VerificationStatus.REJECTED;
    const updated = await this.prisma.technicianCategory.update({
      where: { id: row.id },
      data: {
        ...(dto.yearsOfExperience !== undefined
          ? { yearsOfExperience: dto.yearsOfExperience }
          : {}),
        ...(resubmit
          ? {
              status: VerificationStatus.PENDING,
              reviewNote: null,
              reviewedById: null,
              reviewedAt: null,
            }
          : {}),
      },
      include: SERVICE_INCLUDE,
    });
    if (resubmit) {
      await this.audit.log({
        entityType: 'TechnicianService',
        entityId: row.id,
        action: 'SERVICE_RESUBMITTED',
        fromStatus: VerificationStatus.REJECTED,
        toStatus: VerificationStatus.PENDING,
        actorId: userId,
      });
    }
    return this.toResponse(updated);
  }

  /** Withdraws a service that is waiting for review or was rejected. */
  async withdraw(userId: string, serviceId: string) {
    const profile = await this.requireProfile(userId);
    const row = await this.requireOwnService(profile.id, serviceId);
    if (row.status === VerificationStatus.APPROVED) {
      throw new ConflictException(
        'Approved services stay on your profile. Contact Fundi support to remove one.',
      );
    }
    await this.prisma.technicianCategory.delete({ where: { id: row.id } });
    await this.audit.log({
      entityType: 'TechnicianService',
      entityId: row.id,
      action: 'SERVICE_WITHDRAWN',
      fromStatus: row.status,
      actorId: userId,
    });
    return { id: row.id, withdrawn: true };
  }

  // ─── Admin ──────────────────────────────────────────────────────────────

  /** Services waiting for review (or with another status), oldest first, with their certificates. */
  async listForReview(query: ListTechnicianServicesQueryDto) {
    const status = query.status ?? VerificationStatus.PENDING;
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where: Prisma.TechnicianCategoryWhereInput = { status };
    const [total, rows] = await Promise.all([
      this.prisma.technicianCategory.count({ where }),
      this.prisma.technicianCategory.findMany({
        where,
        include: {
          ...SERVICE_INCLUDE,
          technician: {
            select: {
              id: true,
              verificationStatus: true,
              user: { select: { id: true, fullName: true, phoneNumber: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const certificates = rows.length
      ? await this.prisma.technicianDocument.findMany({
          where: {
            type: DocumentType.CERTIFICATE,
            technicianId: { in: rows.map((row) => row.technicianId) },
          },
          select: {
            id: true,
            technicianId: true,
            title: true,
            status: true,
            certificateType: true,
            categoryId: true,
            customCategoryNormalized: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    return {
      data: rows.map((row) => ({
        ...this.toResponse(row),
        technician: {
          id: row.technician.id,
          verificationStatus: row.technician.verificationStatus,
          fullName: row.technician.user.fullName,
          phoneNumber: row.technician.user.phoneNumber,
        },
        // Certificates filed for this service.
        certificates: certificates
          .filter(
            (doc) =>
              doc.technicianId === row.technicianId &&
              (row.categoryId
                ? doc.categoryId === row.categoryId
                : !doc.categoryId &&
                  doc.customCategoryNormalized === row.customNameNormalized),
          )
          .map(
            ({ technicianId: _t, customCategoryNormalized: _c, ...doc }) => doc,
          ),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async review(
    serviceId: string,
    adminId: string,
    dto: ReviewTechnicianServiceDto,
  ) {
    const row = await this.prisma.technicianCategory.findUnique({
      where: { id: serviceId },
      include: {
        ...SERVICE_INCLUDE,
        technician: { select: { id: true, userId: true } },
      },
    });
    if (!row) throw new NotFoundException('Service not found.');
    const approved = dto.status === VerificationStatus.APPROVED;
    const reason = approved ? null : (dto.reason?.trim() ?? '');
    if (!approved && !reason) {
      throw new BadRequestException('Give a reason when rejecting a service.');
    }
    const updated = await this.prisma.technicianCategory.update({
      where: { id: row.id },
      data: {
        status: dto.status,
        reviewNote: reason,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
      include: SERVICE_INCLUDE,
    });
    const name = row.category?.name ?? row.customName ?? 'Your service';
    await this.audit.log({
      entityType: 'TechnicianService',
      entityId: row.id,
      action: approved ? 'SERVICE_APPROVED' : 'SERVICE_REJECTED',
      fromStatus: row.status,
      toStatus: dto.status,
      actorId: adminId,
      metadata: { technicianId: row.technicianId, service: name, reason },
    });
    await this.notifications
      .create({
        userId: row.technician.userId,
        type: NotificationType.SYSTEM,
        title: approved ? `${name} approved` : `${name} not approved`,
        body: approved
          ? `You can now receive ${name} jobs.`
          : `Reason: ${reason?.replace(/[.!?\s]+$/, '')}. You can change it and send it again from your services.`,
        data: {
          kind: 'SERVICE_REVIEWED',
          serviceId: row.id,
          status: dto.status,
          dedupeKey: `service-review:${row.id}:${dto.status}`,
        },
      })
      .catch(() => undefined);
    return this.toResponse(updated);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private toResponse(row: ServiceRow) {
    return {
      id: row.id,
      categoryId: row.categoryId,
      category: row.category,
      customName: row.customName,
      yearsOfExperience: row.yearsOfExperience,
      status: row.status,
      reviewNote: row.reviewNote,
      reviewedAt: row.reviewedAt,
      createdAt: row.createdAt,
    };
  }

  private async requireProfile(userId: string) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      select: { id: true, verificationStatus: true },
    });
    if (!profile) {
      throw new NotFoundException('Technician profile not found.');
    }
    return profile;
  }

  private async requireOwnService(technicianId: string, serviceId: string) {
    const row = await this.prisma.technicianCategory.findFirst({
      where: { id: serviceId, technicianId },
    });
    if (!row) throw new NotFoundException('Service not found.');
    return row;
  }
}
