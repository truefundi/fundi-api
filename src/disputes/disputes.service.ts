import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { ResolveDisputeDto } from './dto/dispute.dto';

/**
 * Admin view of customer/technician disputes. The jobs service owns the job
 * response shape, so disputes reuse its admin reader instead of duplicating the
 * job include and mapping. Opening and answering a dispute happens in the apps;
 * the admin only lists, inspects, and decides.
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
