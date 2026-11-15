import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
} from '../common/dto/pagination.constants';
import { PagedQueryDto } from '../common/dto/paged-query.dto';
import { PrismaService } from '../database/prisma.service';
import { CreateJobRatingDto, UpdateJobRatingDto } from './dto/job-rating.dto';
import {
  CreateRatingItemDto,
  UpdateRatingItemDto,
} from './dto/rating-item.dto';

const RATING_INCLUDE = {
  responses: {
    orderBy: { itemNameSnapshot: 'asc' as const },
  },
  customer: { select: { id: true, fullName: true } },
  submittedBy: { select: { id: true, fullName: true, role: true } },
  technician: {
    select: { id: true, user: { select: { id: true, fullName: true } } },
  },
  job: {
    select: {
      id: true,
      completedAt: true,
      serviceCategory: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.JobRatingInclude;

type RatingRecord = Prisma.JobRatingGetPayload<{
  include: typeof RATING_INCLUDE;
}>;

@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listRatingItems() {
    return this.prisma.ratingItem.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async getRatingItem(id: string) {
    const item = await this.prisma.ratingItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Rating item not found.');
    return item;
  }

  async createRatingItem(dto: CreateRatingItemDto, adminId: string) {
    const data = {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      sortOrder: dto.sortOrder ?? 0,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.ratingItem.create({ data });
        await this.audit.log(
          {
            entityType: 'RatingItem',
            entityId: item.id,
            action: 'CREATED',
            actorId: adminId,
            metadata: data,
          },
          tx,
        );
        return item;
      });
    } catch (error) {
      this.rethrow(error, 'A rating item with this name already exists.');
    }
  }

  async updateRatingItem(
    id: string,
    dto: UpdateRatingItemDto,
    adminId: string,
  ) {
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.sortOrder === undefined &&
      dto.isActive === undefined
    ) {
      throw new BadRequestException('Provide a rating item field to update.');
    }
    const data = {
      name: dto.name?.trim(),
      description:
        dto.description === undefined
          ? undefined
          : dto.description.trim() || null,
      sortOrder: dto.sortOrder,
      isActive: dto.isActive,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.ratingItem.update({ where: { id }, data });
        await this.audit.log(
          {
            entityType: 'RatingItem',
            entityId: id,
            action: 'UPDATED',
            actorId: adminId,
            metadata: {
              ...(dto.name !== undefined ? { name: data.name } : {}),
              ...(dto.description !== undefined
                ? { description: data.description }
                : {}),
              ...(dto.sortOrder !== undefined
                ? { sortOrder: dto.sortOrder }
                : {}),
              ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            },
          },
          tx,
        );
        return item;
      });
    } catch (error) {
      this.rethrow(error, 'A rating item with this name already exists.');
    }
  }

  async archiveRatingItem(id: string, adminId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.ratingItem.update({
          where: { id },
          data: { isActive: false },
        });
        await this.audit.log(
          {
            entityType: 'RatingItem',
            entityId: id,
            action: 'ARCHIVED',
            actorId: adminId,
            metadata: { isActive: false },
          },
          tx,
        );
        return { message: 'Rating item archived.', item };
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async listItemsForJob(ownerId: string, jobId: string) {
    const job = await this.findCompletedJob(jobId, ownerId);
    const [items, rating] = await Promise.all([
      this.prisma.ratingItem.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.jobRating.findUnique({
        where: { jobId },
        include: RATING_INCLUDE,
      }),
    ]);

    return {
      jobId,
      items,
      canSubmit: !rating && job.ratedAt === null,
      rating: rating ? this.toResponse(rating, false) : null,
    };
  }

  async getJobRatingForOwner(ownerId: string, jobId: string) {
    await this.findCompletedJob(jobId, ownerId);
    const rating = await this.prisma.jobRating.findUnique({
      where: { jobId },
      include: RATING_INCLUDE,
    });
    if (!rating) throw new NotFoundException('Rating not found.');
    return this.toResponse(rating, false);
  }

  submitJobRating(ownerId: string, jobId: string, dto: CreateJobRatingDto) {
    return this.createJobRating(jobId, dto, ownerId, ownerId);
  }

  submitJobRatingAsAdmin(
    jobId: string,
    dto: CreateJobRatingDto,
    adminId: string,
  ) {
    return this.createJobRating(jobId, dto, undefined, adminId);
  }

  async updateJobRatingAsAdmin(
    jobId: string,
    dto: UpdateJobRatingDto,
    adminId: string,
  ) {
    if (dto.responses === undefined && dto.comment === undefined) {
      throw new BadRequestException('Provide rating scores or a comment.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const rating = await tx.jobRating.findUnique({
          where: { jobId },
          include: { responses: true },
        });
        if (!rating) throw new NotFoundException('Rating not found.');

        if (dto.responses) {
          this.assertExactResponseSet(
            rating.responses.map((response) => response.ratingItemId),
            dto.responses.map((response) => response.itemId),
          );
          await Promise.all(
            dto.responses.map((response) =>
              tx.ratingResponse.update({
                where: {
                  jobRatingId_ratingItemId: {
                    jobRatingId: rating.id,
                    ratingItemId: response.itemId,
                  },
                },
                data: { score: response.score },
              }),
            ),
          );
        }

        const updated = await tx.jobRating.update({
          where: { id: rating.id },
          data: {
            ...(dto.comment !== undefined
              ? { comment: dto.comment?.trim() || null }
              : {}),
            submittedById: adminId,
          },
          include: RATING_INCLUDE,
        });
        const average =
          updated.responses.reduce((sum, item) => sum + item.score, 0) /
          updated.responses.length;
        if (updated.jobId) {
          await tx.job.update({
            where: { id: updated.jobId },
            data: {
              ratingOverall: Math.round(average),
              ratingComment: updated.comment,
            },
          });
        }
        await this.audit.log(
          {
            entityType: 'JobRating',
            entityId: rating.id,
            action: 'ADMIN_CORRECTED',
            actorId: adminId,
            metadata: {
              jobId,
              ...(dto.comment !== undefined
                ? { comment: updated.comment }
                : {}),
              ...(dto.responses
                ? {
                    responses: dto.responses.map(({ itemId, score }) => ({
                      itemId,
                      score,
                    })),
                  }
                : {}),
            } as Prisma.InputJsonObject,
          },
          tx,
        );
        return this.toResponse(updated, true);
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async getJobRatingForAdmin(jobId: string) {
    const rating = await this.prisma.jobRating.findUnique({
      where: { jobId },
      include: RATING_INCLUDE,
    });
    if (!rating) throw new NotFoundException('Rating not found.');
    return this.toResponse(rating, true);
  }

  async listTechnicianRatings(
    technicianId: string,
    query: PagedQueryDto,
    viewer: 'admin' | 'technician',
  ) {
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { id: technicianId },
      select: { id: true, user: { select: { fullName: true } } },
    });
    if (!technician) {
      throw new NotFoundException('Technician profile not found.');
    }

    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const where = { technicianId };
    const [total, responseAverage, itemAverages, ratings] = await Promise.all([
      this.prisma.jobRating.count({ where }),
      this.prisma.ratingResponse.aggregate({
        where: { jobRating: { technicianId } },
        _avg: { score: true },
        _count: { _all: true },
      }),
      this.prisma.ratingResponse.groupBy({
        by: ['itemNameSnapshot'],
        where: { jobRating: { technicianId } },
        _avg: { score: true },
        _count: { _all: true },
        orderBy: { itemNameSnapshot: 'asc' },
      }),
      this.prisma.jobRating.findMany({
        where,
        orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: RATING_INCLUDE,
      }),
    ]);

    return {
      technician: {
        id: technician.id,
        fullName: technician.user.fullName,
      },
      summary: {
        ratingCount: total,
        responseCount: responseAverage._count._all,
        averageScore: this.roundAverage(responseAverage._avg.score),
        items: itemAverages.map((item) => ({
          name: item.itemNameSnapshot,
          averageScore: this.roundAverage(item._avg.score),
          responseCount: item._count._all,
        })),
      },
      data: ratings.map((rating) =>
        this.toResponse(rating, viewer === 'admin'),
      ),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async listMyTechnicianRatings(userId: string, query: PagedQueryDto) {
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!technician) {
      throw new NotFoundException('Technician profile not found.');
    }
    return this.listTechnicianRatings(technician.id, query, 'technician');
  }

  private async createJobRating(
    jobId: string,
    dto: CreateJobRatingDto,
    ownerId: string | undefined,
    submittedById: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const job = await tx.job.findUnique({
          where: { id: jobId },
          select: {
            id: true,
            customerId: true,
            technicianId: true,
            status: true,
            ratedAt: true,
          },
        });
        if (!job || (ownerId && job.customerId !== ownerId)) {
          throw new NotFoundException('Completed job not found.');
        }
        if (job.status !== JobStatus.COMPLETED || !job.technicianId) {
          throw new ConflictException(
            'Only a completed job with an assigned technician can be rated.',
          );
        }
        if (job.ratedAt) {
          throw new ConflictException('This job has already been rated.');
        }

        const items = await tx.ratingItem.findMany({
          where: { isActive: true },
          select: { id: true, name: true },
        });
        if (items.length === 0) {
          throw new ConflictException(
            'No active rating items are available for this job.',
          );
        }
        this.assertExactResponseSet(
          items.map((item) => item.id),
          dto.responses.map((response) => response.itemId),
        );
        const itemNames = new Map(items.map((item) => [item.id, item.name]));
        const average =
          dto.responses.reduce((sum, response) => sum + response.score, 0) /
          dto.responses.length;
        const rating = await tx.jobRating.create({
          data: {
            jobId,
            customerId: job.customerId,
            technicianId: job.technicianId,
            submittedById,
            comment: dto.comment?.trim() || null,
            responses: {
              create: dto.responses.map((response) => ({
                ratingItemId: response.itemId,
                itemNameSnapshot: itemNames.get(response.itemId)!,
                score: response.score,
              })),
            },
          },
          include: RATING_INCLUDE,
        });
        await tx.job.update({
          where: { id: jobId },
          data: {
            ratedAt: new Date(),
            ratingOverall: Math.round(average),
            ratingComment: rating.comment,
          },
        });
        await this.audit.log(
          {
            entityType: 'JobRating',
            entityId: rating.id,
            action: 'CREATED',
            actorId: submittedById,
            metadata: {
              jobId,
              technicianId: job.technicianId,
              customerId: job.customerId,
              averageScore: this.roundAverage(average),
              responseCount: dto.responses.length,
              submittedOnBehalf: submittedById !== job.customerId,
            },
          },
          tx,
        );
        return this.toResponse(rating, ownerId === undefined);
      });
    } catch (error) {
      this.rethrow(error, 'This job has already been rated.');
    }
  }

  private async findCompletedJob(jobId: string, ownerId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, customerId: ownerId },
      select: {
        id: true,
        ratedAt: true,
        status: true,
        technicianId: true,
      },
    });
    if (!job) throw new NotFoundException('Job not found.');
    if (job.status !== JobStatus.COMPLETED || !job.technicianId) {
      throw new ConflictException(
        'Rating is available only for a completed job with an assigned technician.',
      );
    }
    return job;
  }

  private assertExactResponseSet(expectedIds: string[], actualIds: string[]) {
    const expected = new Set(expectedIds);
    const actual = new Set(actualIds);
    if (
      actual.size !== actualIds.length ||
      expected.size !== actual.size ||
      [...expected].some((id) => !actual.has(id))
    ) {
      throw new BadRequestException(
        'Provide exactly one score for every required rating item.',
      );
    }
  }

  private toResponse(rating: RatingRecord, includeCustomer: boolean) {
    const average =
      rating.responses.reduce((sum, response) => sum + response.score, 0) /
      rating.responses.length;
    return {
      id: rating.id,
      jobId: rating.jobId,
      submittedAt: rating.submittedAt,
      updatedAt: rating.updatedAt,
      comment: rating.comment,
      averageScore: this.roundAverage(average),
      ...(includeCustomer
        ? {
            customer: rating.customer,
            submittedBy: rating.submittedBy,
          }
        : {}),
      technician: rating.technician,
      job: rating.job,
      responses: rating.responses.map((response) => ({
        itemId: response.ratingItemId,
        item: response.itemNameSnapshot,
        score: response.score,
      })),
    };
  }

  private roundAverage(value: number | null) {
    return value === null ? null : Number(value.toFixed(2));
  }

  private rethrow(
    error: unknown,
    conflictMessage = 'The rating conflicts with existing data.',
  ): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException(conflictMessage);
      }
      if (error.code === 'P2025') {
        throw new NotFoundException(
          'The requested rating record was not found.',
        );
      }
    }
    throw error;
  }
}
