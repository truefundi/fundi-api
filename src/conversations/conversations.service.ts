import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatRoomStatus,
  ConversationMessageType,
  ConversationSender,
  ConversationStatus,
  JobStatus,
  NotificationType,
  Prisma,
  PriceOfferStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CONVERSATION_MAX_OFFERS_PER_SIDE,
  CONVERSATION_MAX_TOTAL_OFFERS,
  CONVERSATION_OFFER_TTL_SECONDS,
} from './conversation.constants';
import { CreateOfferDto } from './dto/create-offer.dto';
import { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import { PostMessageDto } from './dto/post-message.dto';
import { RespondOfferDto } from './dto/respond-offer.dto';
import {
  canRespondToOffer,
  isOfferExpired,
  participantRole,
} from './negotiation.util';

// Everything a conversation response needs. The customer and technician are
// derived from the job so the conversation never duplicates job state.
const CONVERSATION_INCLUDE = {
  job: {
    select: {
      id: true,
      status: true,
      customerId: true,
      technicianId: true,
      description: true,
      locationAddress: true,
      latitude: true,
      longitude: true,
      otherServiceName: true,
      customer: { select: { id: true, fullName: true, phoneNumber: true } },
      serviceCategory: { select: { id: true, name: true, slug: true } },
      technician: {
        select: {
          id: true,
          userId: true,
          user: { select: { id: true, fullName: true, phoneNumber: true } },
        },
      },
    },
  },
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: { offer: true },
  },
} satisfies Prisma.ConversationInclude;

type ConversationWithDetails = Prisma.ConversationGetPayload<{
  include: typeof CONVERSATION_INCLUDE;
}>;

type MessageWithOffer = ConversationWithDetails['messages'][number];
type OfferRecord = NonNullable<MessageWithOffer['offer']>;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Returns the conversation for a job. Job-core opens it, already NEGOTIATING,
   * when a technician accepts the job offer. This call covers jobs assigned
   * before that: a missing or still-PENDING conversation is opened for the
   * assigned technician, as is one a previous technician declined. Only the
   * job's customer can call it. Idempotent.
   */
  async open(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        customerId: true,
        technicianId: true,
        description: true,
        locationAddress: true,
        latitude: true,
        longitude: true,
        otherServiceName: true,
        serviceCategory: { select: { name: true } },
        technician: { select: { userId: true } },
      },
    });
    if (!job || job.customerId !== userId) {
      throw new NotFoundException('Job not found.');
    }
    if (!job.technicianId) {
      throw new ConflictException(
        'This job has no assigned technician to negotiate with.',
      );
    }

    const technicianUserId = job.technician?.userId ?? null;
    const existing = await this.findByJobId(jobId);
    if (existing) {
      // A job-request decline returns the job to dispatch. When a different
      // technician has since been assigned, the closed conversation is
      // reopened for them.
      const needsOpening =
        existing.status === ConversationStatus.PENDING ||
        (existing.status === ConversationStatus.DECLINED &&
          technicianUserId !== null &&
          this.jobRequestDecliner(existing) !== null &&
          this.jobRequestDecliner(existing) !== technicianUserId);
      if (!needsOpening || !technicianUserId) return this.toResponse(existing);
    }
    if (!technicianUserId) {
      throw new ConflictException(
        'This job has no assigned technician to negotiate with.',
      );
    }

    try {
      await this.prisma.$transaction((tx) =>
        this.jobs.openNegotiationForAssignment(tx, jobId, technicianUserId),
      );
    } catch (error) {
      // The unique jobId index makes concurrent opens safe; return the winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const race = await this.findByJobId(jobId);
        if (race) return this.toResponse(race);
      }
      throw error;
    }

    return this.get(userId, (await this.findByJobIdOrThrow(jobId)).id);
  }

  /** Reads a conversation. Only the two participants may see it. */
  async get(userId: string, conversationId: string) {
    const conversation = await this.find(conversationId);
    this.assertParticipant(conversation, userId);
    await this.expireStaleOffers(conversationId);
    const refreshed = await this.find(conversationId);
    return this.toResponse(refreshed);
  }

  /**
   * Accepts the job request carried by the conversation, opening the price
   * negotiation. Only the assigned technician may answer, and only while the
   * conversation is still PENDING. The job itself is already assigned by
   * job-core's dispatch flow; this records the acceptance and unlocks offers.
   */
  async acceptJobRequest(userId: string, conversationId: string) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    this.assertTechnicianResponder(role);
    this.assertPending(conversation.status);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const accepted = await tx.conversation.updateMany({
        where: { id: conversationId, status: ConversationStatus.PENDING },
        data: { status: ConversationStatus.NEGOTIATING, lastMessageAt: now },
      });
      if (!accepted.count) {
        throw new ConflictException(
          'This job request has already been answered.',
        );
      }
      await tx.conversationMessage.create({
        data: {
          conversationId,
          senderId: userId,
          senderRole: ConversationSender.TECHNICIAN,
          type: ConversationMessageType.TECHNICIAN_RESPONSE,
          metadata: { decision: 'ACCEPTED' },
        },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversationId,
          action: 'JOB_REQUEST_ACCEPTED',
          actorId: userId,
          fromStatus: ConversationStatus.PENDING,
          toStatus: ConversationStatus.NEGOTIATING,
          metadata: { jobId: conversation.jobId },
        },
        tx,
      );
    });

    await this.notifyOther(conversation, userId, {
      type: NotificationType.JOB_ACCEPTED,
      title: 'Technician accepted your request',
      body: 'Your technician accepted the job request. You can now agree on a price.',
      data: { conversationId, jobId: conversation.jobId },
      dedupeKey: `job-request-accepted:${conversationId}`,
    });

    return this.get(userId, conversationId);
  }

  /**
   * Declines the job request carried by the conversation. The conversation is
   * closed first, then the existing job-core decline workflow takes over: the
   * assignment is dropped and the job returns to dispatch for the next
   * eligible technician. Only the assigned technician may answer.
   */
  async declineJobRequest(
    userId: string,
    conversationId: string,
    dto: RespondOfferDto,
  ) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    this.assertTechnicianResponder(role);
    this.assertPending(conversation.status);

    const reason = dto.reason ?? null;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const declined = await tx.conversation.updateMany({
        where: { id: conversationId, status: ConversationStatus.PENDING },
        data: {
          status: ConversationStatus.DECLINED,
          declinedById: userId,
          declineReason: reason,
          lastMessageAt: now,
          closedAt: now,
        },
      });
      if (!declined.count) {
        throw new ConflictException(
          'This job request has already been answered.',
        );
      }
      await tx.conversationMessage.create({
        data: {
          conversationId,
          senderId: userId,
          senderRole: ConversationSender.TECHNICIAN,
          type: ConversationMessageType.TECHNICIAN_RESPONSE,
          metadata: { decision: 'DECLINED', reason },
        },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversationId,
          action: 'JOB_REQUEST_DECLINED',
          actorId: userId,
          fromStatus: ConversationStatus.PENDING,
          toStatus: ConversationStatus.DECLINED,
          metadata: { jobId: conversation.jobId, reason },
        },
        tx,
      );
    });

    // Capture the response while the caller is still a participant: job-core's
    // drop clears the assignment, which removes the technician from the job.
    const response = await this.get(userId, conversationId);
    await this.jobs.dropJob(userId, conversation.jobId, {
      reason: reason ?? 'Declined the job request in the conversation.',
    });
    return response;
  }

  /** Posts a short text message inside the negotiation. */
  async postMessage(
    userId: string,
    conversationId: string,
    dto: PostMessageDto,
  ) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    this.assertNegotiating(conversation.status);
    this.assertAssignmentActive(conversation);
    await this.assertChatNotDisabled(conversation.job.id);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.conversationMessage.create({
        data: {
          conversationId,
          senderId: userId,
          senderRole: role,
          type: ConversationMessageType.TEXT,
          text: dto.text,
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversationId,
          action: 'CONVERSATION_MESSAGE_SENT',
          actorId: userId,
          metadata: { role },
        },
        tx,
      );
    });

    await this.notifyOther(conversation, userId, {
      type: NotificationType.CONVERSATION_MESSAGE,
      title: 'New message',
      body: dto.text.trim().slice(0, 140),
      data: { conversationId, jobId: conversation.jobId },
    });

    return this.get(userId, conversationId);
  }

  /**
   * Posts a price offer or counter-offer. Supersedes the outstanding offer, and
   * rejects the request once the per-side or overall offer limit is reached.
   */
  async createOffer(
    userId: string,
    conversationId: string,
    dto: CreateOfferDto,
  ) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    await this.expireStaleOffers(conversationId);
    const current = await this.find(conversationId);
    this.assertNegotiating(current.status);
    this.assertAssignmentActive(current);

    const pending = this.pendingOffer(current);
    if (pending && pending.amount === dto.amount) {
      throw new ConflictException('That is already the amount on the table.');
    }
    this.assertOfferLimit(current, role);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + CONVERSATION_OFFER_TTL_SECONDS * 1000,
    );
    const notes = dto.notes ?? null;

    await this.prisma.$transaction(async (tx) => {
      if (pending) {
        await tx.priceOffer.update({
          where: { id: pending.id },
          data: { status: PriceOfferStatus.SUPERSEDED, respondedAt: now },
        });
      }
      const message = await tx.conversationMessage.create({
        data: {
          conversationId,
          senderId: userId,
          senderRole: role,
          type: ConversationMessageType.PRICE_OFFER,
          text: notes,
        },
        select: { id: true },
      });
      const offer = await tx.priceOffer.create({
        data: {
          conversationId,
          messageId: message.id,
          amount: dto.amount,
          currency: current.currency,
          senderRole: role,
          status: PriceOfferStatus.PENDING,
          notes,
          expiresAt,
        },
        select: { id: true },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { offerCount: { increment: 1 }, lastMessageAt: now },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversationId,
          action: 'PRICE_OFFER_SENT',
          actorId: userId,
          fromStatus: current.status,
          toStatus: current.status,
          metadata: { offerId: offer.id, amount: dto.amount, role },
        },
        tx,
      );
    });

    await this.notifyOther(conversation, userId, {
      type: NotificationType.OFFER_SENT,
      title: 'New price offer',
      body: `You received an offer of ${dto.amount} ${current.currency}.`,
      data: {
        conversationId,
        jobId: conversation.jobId,
        amount: dto.amount,
        currency: current.currency,
      },
      dedupeKey: `offer-sent:${conversationId}:${dto.amount}:${userId}`,
    });

    return this.get(userId, conversationId);
  }

  /**
   * Accepts the outstanding offer: the price is agreed, the negotiation closes
   * and cooperation is confirmed for both sides in the same transaction.
   */
  async acceptOffer(userId: string, conversationId: string, offerId: string) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    await this.expireStaleOffers(conversationId);
    const current = await this.find(conversationId);
    this.assertNegotiating(current.status);
    this.assertAssignmentActive(current);

    const offer = this.requireOffer(current, offerId);
    if (offer.status !== PriceOfferStatus.PENDING) {
      throw new ConflictException(
        'This offer is no longer awaiting a response.',
      );
    }
    // The responder check comes first: an invalid responder must be refused for the
    // reason that applies to them, not masked behind an expiry the offer may no
    // longer be in.
    if (!canRespondToOffer(offer.senderRole, role)) {
      throw new ForbiddenException('You cannot respond to your own offer.');
    }
    if (isOfferExpired(offer.expiresAt)) {
      await this.expireStaleOffers(conversationId);
      throw new ConflictException('This offer has expired.');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const accepted = await tx.priceOffer.updateMany({
        where: { id: offer.id, status: PriceOfferStatus.PENDING },
        data: { status: PriceOfferStatus.ACCEPTED, respondedAt: now },
      });
      if (!accepted.count) {
        throw new ConflictException(
          'This offer is no longer awaiting a response.',
        );
      }
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: ConversationStatus.AGREED,
          agreedAmount: offer.amount,
          lastMessageAt: now,
          closedAt: now,
        },
      });
      // One side offered and the other accepted: that is both confirmations.
      await this.jobs.confirmCooperationForAgreement(
        tx,
        conversation.jobId,
        userId,
      );
      await tx.conversationMessage.create({
        data: {
          conversationId,
          senderRole: ConversationSender.SYSTEM,
          type: ConversationMessageType.SYSTEM,
          text: `Agreed at ${offer.amount} ${offer.currency}. The job is confirmed.`,
        },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversationId,
          action: 'CONVERSATION_AGREED',
          actorId: userId,
          fromStatus: ConversationStatus.NEGOTIATING,
          toStatus: ConversationStatus.AGREED,
          metadata: { offerId: offer.id, amount: offer.amount },
        },
        tx,
      );
    });

    await this.notifyOther(conversation, userId, {
      type: NotificationType.OFFER_ACCEPTED,
      title: 'Price agreed: job confirmed',
      body: `Your offer of ${offer.amount} ${offer.currency} was accepted. The job is confirmed.`,
      data: {
        conversationId,
        jobId: conversation.jobId,
        amount: offer.amount,
        currency: offer.currency,
      },
      dedupeKey: `offer-accepted:${offer.id}`,
    });

    return this.get(userId, conversationId);
  }

  /**
   * Declines the outstanding offer. The negotiation stays open so either side
   * can make another offer within their limit; ending the partnership is a
   * separate action (pull out).
   */
  async declineOffer(
    userId: string,
    conversationId: string,
    offerId: string,
    dto: RespondOfferDto,
  ) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    await this.expireStaleOffers(conversationId);
    const current = await this.find(conversationId);
    this.assertNegotiating(current.status);
    this.assertAssignmentActive(current);

    const offer = this.requireOffer(current, offerId);
    if (offer.status !== PriceOfferStatus.PENDING) {
      throw new ConflictException(
        'This offer is no longer awaiting a response.',
      );
    }
    // The responder check comes first: an invalid responder must be refused for the
    // reason that applies to them, not masked behind an expiry the offer may no
    // longer be in.
    if (!canRespondToOffer(offer.senderRole, role)) {
      throw new ForbiddenException('You cannot respond to your own offer.');
    }
    if (isOfferExpired(offer.expiresAt)) {
      await this.expireStaleOffers(conversationId);
      throw new ConflictException('This offer has expired.');
    }

    const now = new Date();
    const reason = dto.reason ?? null;
    await this.prisma.$transaction(async (tx) => {
      const declined = await tx.priceOffer.updateMany({
        where: { id: offer.id, status: PriceOfferStatus.PENDING },
        data: { status: PriceOfferStatus.DECLINED, respondedAt: now },
      });
      if (!declined.count) {
        throw new ConflictException(
          'This offer is no longer awaiting a response.',
        );
      }
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now },
      });
      await tx.conversationMessage.create({
        data: {
          conversationId,
          senderRole: ConversationSender.SYSTEM,
          type: ConversationMessageType.SYSTEM,
          text: reason ? `Offer declined: ${reason}` : 'Offer declined.',
        },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversationId,
          action: 'PRICE_OFFER_DECLINED',
          actorId: userId,
          fromStatus: ConversationStatus.NEGOTIATING,
          toStatus: ConversationStatus.NEGOTIATING,
          metadata: { offerId: offer.id, reason },
        },
        tx,
      );
    });

    await this.notifyOther(conversation, userId, {
      type: NotificationType.OFFER_DECLINED,
      title: 'Price offer declined',
      body: reason
        ? `Your offer was declined: ${reason}. You can make another offer.`
        : 'Your offer was declined. You can make another offer.',
      data: {
        conversationId,
        jobId: conversation.jobId,
        amount: offer.amount,
        currency: offer.currency,
      },
      dedupeKey: `offer-declined:${offer.id}`,
    });

    return this.get(userId, conversationId);
  }

  /** Lists the caller's conversations, newest activity first. */
  async listForUser(userId: string, query: ListConversationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ConversationWhereInput = {
      OR: [
        { job: { is: { customerId: userId } } },
        { job: { is: { technician: { is: { userId } } } } },
      ],
    };
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toResponse(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Admin list. Read-only; paginated and filterable by status and search. */
  async listForAdmin(query: ListConversationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.ConversationWhereInput = {};
    if (query.status) where.status = query.status;
    const search = query.search?.trim();
    if (search) {
      where.job = {
        is: {
          OR: [
            { description: { contains: search, mode: 'insensitive' } },
            { otherServiceName: { contains: search, mode: 'insensitive' } },
            {
              serviceCategory: {
                is: { name: { contains: search, mode: 'insensitive' } },
              },
            },
            {
              customer: {
                is: { fullName: { contains: search, mode: 'insensitive' } },
              },
            },
            {
              technician: {
                is: {
                  user: {
                    is: { fullName: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            },
          ],
        },
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: CONVERSATION_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toResponse(row)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /** Admin detail. Read-only; expires lapsed offers first. */
  async getForAdmin(conversationId: string) {
    const conversation = await this.find(conversationId);
    await this.expireStaleOffers(conversation.id);
    const refreshed = await this.find(conversationId);
    return this.toResponse(refreshed);
  }

  /**
   * Admin read of the conversation attached to a job, or null when the job never
   * opened one. Used by dispute review, where the chat is the evidence.
   */
  async getForAdminByJobId(jobId: string) {
    const conversation = await this.findByJobId(jobId);
    if (!conversation) return null;
    await this.expireStaleOffers(conversation.id);
    const refreshed = await this.find(conversation.id);
    return this.toResponse(refreshed);
  }

  /**
   * Flips offers whose expiry has passed to EXPIRED and records a system line,
   * so lapsed offers never count as outstanding. Called before reads and writes.
   */
  private async expireStaleOffers(conversationId: string): Promise<void> {
    const now = new Date();
    const stale = await this.prisma.priceOffer.findMany({
      where: {
        conversationId,
        status: PriceOfferStatus.PENDING,
        expiresAt: { lte: now },
      },
      select: { id: true },
    });
    if (!stale.length) return;

    await this.prisma.$transaction(async (tx) => {
      for (const offer of stale) {
        const updated = await tx.priceOffer.updateMany({
          where: { id: offer.id, status: PriceOfferStatus.PENDING },
          data: { status: PriceOfferStatus.EXPIRED, respondedAt: now },
        });
        if (!updated.count) continue;
        await tx.conversationMessage.create({
          data: {
            conversationId,
            senderRole: ConversationSender.SYSTEM,
            type: ConversationMessageType.SYSTEM,
            text: 'A price offer expired.',
          },
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: now },
        });
        await this.audit.log(
          {
            entityType: 'Conversation',
            entityId: conversationId,
            action: 'PRICE_OFFER_EXPIRED',
            metadata: { offerId: offer.id },
          },
          tx,
        );
      }
    });
  }

  /**
   * Sends an in-app notification to the participant who did not perform the
   * action. Notification failures are swallowed: they must never roll back a
   * negotiation that has already been committed.
   */
  private async notifyOther(
    conversation: ConversationWithDetails,
    actorId: string,
    input: {
      type: NotificationType;
      title: string;
      body: string;
      data?: Record<string, unknown>;
      dedupeKey?: string;
    },
  ): Promise<void> {
    if (!this.notifications) return;
    const recipientId =
      conversation.job.customerId === actorId
        ? conversation.job.technician?.userId
        : conversation.job.customerId;
    if (!recipientId || recipientId === actorId) return;
    await this.notifications
      .create({
        userId: recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as Prisma.InputJsonValue | undefined,
        dedupeKey: input.dedupeKey,
      })
      .catch(() => undefined);
  }

  private async find(conversationId: string): Promise<ConversationWithDetails> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: CONVERSATION_INCLUDE,
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return conversation;
  }

  private async findByJobId(
    jobId: string,
  ): Promise<ConversationWithDetails | null> {
    return this.prisma.conversation.findUnique({
      where: { jobId },
      include: CONVERSATION_INCLUDE,
    });
  }

  private async findByJobIdOrThrow(
    jobId: string,
  ): Promise<ConversationWithDetails> {
    const conversation = await this.findByJobId(jobId);
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return conversation;
  }

  /**
   * Confirms the caller is the job's customer or assigned technician and returns
   * the role they act as. A non-participant gets a 404 so the conversation's
   * existence is not revealed.
   */
  private assertParticipant(
    conversation: ConversationWithDetails,
    userId: string,
  ): ConversationSender {
    const isCustomer = conversation.job.customerId === userId;
    const isTechnician = conversation.job.technician?.userId === userId;
    if (!isCustomer && !isTechnician) {
      throw new NotFoundException('Conversation not found.');
    }
    return participantRole(isCustomer);
  }

  private assertNegotiating(status: ConversationStatus): void {
    if (status === ConversationStatus.PENDING) {
      throw new ConflictException(
        'The technician has not accepted the job request yet.',
      );
    }
    if (status !== ConversationStatus.NEGOTIATING) {
      throw new ConflictException('This negotiation is already closed.');
    }
  }

  /**
   * Negotiating needs someone to negotiate with: a technician assigned to a
   * job that is still running. After a pull-out the job is open again and the
   * negotiation is read-only until the next technician accepts.
   */
  private assertAssignmentActive(conversation: ConversationWithDetails): void {
    const { job } = conversation;
    if (
      !job.technicianId ||
      (job.status !== JobStatus.ASSIGNED && job.status !== JobStatus.PAUSED)
    ) {
      throw new ConflictException(
        'This negotiation is closed: no technician is assigned to the job.',
      );
    }
  }

  /**
   * Text sent here must respect the same moderation as the job chat: when an
   * administrator disabled the current assignment's chat room, both channels
   * are read-only.
   */
  private async assertChatNotDisabled(jobId: string): Promise<void> {
    const disabled = await this.prisma.chatRoom.findFirst({
      where: {
        jobId,
        status: ChatRoomStatus.DISABLED,
        assignmentHistory: { is: { endedAt: null } },
      },
      select: { id: true },
    });
    if (disabled) {
      throw new ConflictException('This chat has been closed.');
    }
  }

  private assertPending(status: ConversationStatus): void {
    if (status !== ConversationStatus.PENDING) {
      throw new ConflictException(
        'This job request has already been answered.',
      );
    }
  }

  /** Only the assigned technician may accept or decline the job request. */
  private assertTechnicianResponder(role: ConversationSender): void {
    if (role !== ConversationSender.TECHNICIAN) {
      throw new ForbiddenException(
        'Only the assigned technician can respond to the job request.',
      );
    }
  }

  /**
   * Finds the technician who declined the job request, if the conversation was
   * closed by one. Offer declines are ignored: those keep the same technician.
   */
  private jobRequestDecliner(
    conversation: ConversationWithDetails,
  ): string | null {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      if (message.type !== ConversationMessageType.TECHNICIAN_RESPONSE) {
        continue;
      }
      const metadata = message.metadata as Record<string, unknown> | null;
      if (metadata?.decision === 'DECLINED') return message.senderId;
    }
    return null;
  }

  private assertOfferLimit(
    conversation: ConversationWithDetails,
    role: ConversationSender,
  ): void {
    if (conversation.offerCount >= CONVERSATION_MAX_TOTAL_OFFERS) {
      throw new ConflictException(
        'This negotiation has reached its offer limit.',
      );
    }
    const sideOffers = this.currentRoundMessages(conversation).filter(
      (message) => message.offer?.senderRole === role,
    ).length;
    if (sideOffers >= CONVERSATION_MAX_OFFERS_PER_SIDE) {
      throw new ConflictException(
        'You have reached your offer limit for this negotiation.',
      );
    }
  }

  /**
   * Messages since the current technician accepted the request. A reassigned
   * job reopens the same conversation, and the new technician's negotiation
   * starts with fresh offer limits.
   */
  private currentRoundMessages(
    conversation: ConversationWithDetails,
  ): MessageWithOffer[] {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const message = conversation.messages[index];
      const metadata = message.metadata as Record<string, unknown> | null;
      if (
        message.type === ConversationMessageType.TECHNICIAN_RESPONSE &&
        metadata?.decision === 'ACCEPTED'
      ) {
        return conversation.messages.slice(index);
      }
    }
    return conversation.messages;
  }

  private pendingOffer(
    conversation: ConversationWithDetails,
  ): OfferRecord | null {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
      const offer = conversation.messages[index].offer;
      if (offer?.status === PriceOfferStatus.PENDING) return offer;
    }
    return null;
  }

  private requireOffer(
    conversation: ConversationWithDetails,
    offerId: string,
  ): OfferRecord {
    const message = conversation.messages.find(
      (entry) => entry.offer?.id === offerId,
    );
    if (!message?.offer) throw new NotFoundException('Price offer not found.');
    return message.offer;
  }

  private toResponse(conversation: ConversationWithDetails) {
    const pending = this.pendingOffer(conversation);
    return {
      id: conversation.id,
      jobId: conversation.jobId,
      status: conversation.status,
      currency: conversation.currency,
      agreedAmount: conversation.agreedAmount,
      offerCount: conversation.offerCount,
      declinedById: conversation.declinedById,
      declineReason: conversation.declineReason,
      startedAt: conversation.startedAt,
      lastMessageAt: conversation.lastMessageAt,
      closedAt: conversation.closedAt,
      request: {
        service:
          conversation.job.serviceCategory?.name ??
          conversation.job.otherServiceName,
        description: conversation.job.description,
        locationAddress: conversation.job.locationAddress,
        latitude: conversation.job.latitude,
        longitude: conversation.job.longitude,
      },
      customer: conversation.job.customer,
      technician: conversation.job.technician?.user ?? null,
      currentOffer: pending ? this.offerResponse(pending) : null,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        senderId: message.senderId,
        senderRole: message.senderRole,
        type: message.type,
        text: message.text,
        metadata: (message.metadata as Record<string, unknown> | null) ?? null,
        createdAt: message.createdAt,
        offer: message.offer ? this.offerResponse(message.offer) : null,
      })),
    };
  }

  private offerResponse(offer: OfferRecord) {
    return {
      id: offer.id,
      amount: offer.amount,
      currency: offer.currency,
      senderRole: offer.senderRole as 'CUSTOMER' | 'TECHNICIAN',
      status: offer.status,
      notes: offer.notes,
      expiresAt: offer.expiresAt,
      respondedAt: offer.respondedAt,
      createdAt: offer.createdAt,
    };
  }
}
