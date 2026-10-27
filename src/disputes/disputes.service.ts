import { DisputeOpenedBy, Prisma } from '@prisma/client';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { OpenDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';

/**
 * Customer and technician dispute intake plus admin review. The jobs service
 * owns job response shapes, and conversations provide the evidence for review.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly conversations: ConversationsService,
    private readonly audit: AuditService,
  ) {}

  /** Jobs whose dispute is still open (default) or already resolved, newest first. */
  async listForAdmin(state: 'open' | 'resolved' = 'open') {
    const jobs = await this.jobs.listForAdmin();
    return jobs.filter((job) =>
      state === 'resolved'
        ? Boolean(job.dispute?.resolution)
        : Boolean(job.dispute && !job.dispute.resolution),
    );
  }

  /** The disputed job plus the chat the customer and technician negotiated in. */
  async getForAdmin(jobId: string) {
    const job = await this.jobs.getForAdmin(jobId);
    if (!job.dispute) throw new NotFoundException('Dispute not found.');
    return {
      job,
      chat: await this.conversations.getForAdminByJobId(jobId),
    };
  }

  /**
   * Opens a dispute on a job. Either party may open one: the customer on a job they
   * own, or the technician assigned to it. One dispute may exist per job; once
   * opened it waits for the admin to record a resolution, which is the only step
   * that may settle it.
   */
  async open(userId: string, jobId: string, dto: OpenDisputeDto) {
    let openedBy: DisputeOpenedBy;
    try {
      openedBy = await this.prisma.$transaction(async (tx) => {
        const job = await tx.job.findUnique({
          where: { id: jobId },
          select: { id: true, customerId: true, technicianId: true },
        });
        if (!job) throw new NotFoundException('Job not found.');

        const isCustomer = job.customerId === userId;
        const isTechnician = Boolean(
          job.technicianId &&
            (await tx.technicianProfile.findFirst({
              where: { id: job.technicianId, userId },
              select: { id: true },
            })),
        );
        if (!isCustomer && !isTechnician) {
          throw new NotFoundException('Job not found.');
        }
        if (!job.technicianId) {
          throw new ConflictException(
            'A dispute can only be opened after a technician is assigned.',
          );
        }

        const opener = isCustomer
          ? DisputeOpenedBy.CUSTOMER
          : DisputeOpenedBy.TECHNICIAN;
        const dispute = await tx.dispute.create({
          data: {
            jobId,
            reason: dto.reason.trim(),
            openedBy: opener,
          },
          select: { id: true },
        });

        await this.audit.log(
          {
            entityType: 'Dispute',
            entityId: dispute.id,
            action: 'DISPUTE_OPENED',
            actorId: userId,
            metadata: { jobId, openedBy: opener },
          },
          tx,
        );
        return opener;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A dispute has already been opened for this job.',
        );
      }
      const prismaErr = error as { code?: string } | null;
      if (prismaErr?.code === 'P2002') {
        throw new ConflictException(
          'A dispute has already been opened for this job.',
        );
      }
      throw error;
    }

    return openedBy === DisputeOpenedBy.CUSTOMER
      ? this.jobs.getCustomerJob(userId, jobId)
      : this.jobs.getTechnicianJob(userId, jobId);
  }

  /** Records the decision once; the resolution cannot be edited afterwards. */
  async resolve(jobId: string, dto: ResolveDisputeDto, adminId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { jobId },
      select: { id: true, resolvedAt: true },
    });
    if (!dispute) throw new NotFoundException('Dispute not found.');
    if (dispute.resolvedAt) {
      throw new ConflictException('This dispute has already been resolved.');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const resolved = await tx.dispute.updateMany({
        where: { id: dispute.id, resolvedAt: null },
        data: {
          outcome: dto.outcome,
          amount: dto.amount,
          note: dto.note.trim(),
          resolvedAt: now,
          resolvedById: adminId,
        },
      });
      if (!resolved.count) {
        throw new ConflictException('This dispute has already been resolved.');
      }
      await this.audit.log(
        {
          entityType: 'Dispute',
          entityId: dispute.id,
          action: 'DISPUTE_RESOLVED',
          actorId: adminId,
          metadata: {
            jobId,
            outcome: dto.outcome,
            amount: dto.amount,
          },
        },
        tx,
      );
    });
    return this.jobs.getForAdmin(jobId);
  }
}
