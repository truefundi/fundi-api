import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationMessageType,
  ConversationSender,
  ConversationStatus,
  Prisma,
  PriceOfferStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
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
  ) {}

  /**
   * Opens the conversation for a job, or returns the existing one. Only the job's
   * customer can open it, and only once the job has an assigned technician to
   * negotiate with. A new conversation stays PENDING until that technician
   * accepts or declines the request. If a different technician has since been
   * assigned (the previous one declined the request), the closed conversation is
   * reopened for them. Idempotent: a second call returns the same conversation.
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

    const existing = await this.findByJobId(jobId);
    if (existing) {
      // A job-request decline returns the job to dispatch. When a different
      // technician has since been assigned, the closed conversation is
      // reopened for them; an offer decline (same technician) is left closed.
      if (existing.status === ConversationStatus.DECLINED) {
        const decliner = this.jobRequestDecliner(existing);
        const technicianUserId = job.technician?.userId ?? null;
        if (decliner && technicianUserId && decliner !== technicianUserId) {
          await this.reopenForTechnician(existing, userId);
          return this.get(userId, existing.id);
        }
      }
      return this.toResponse(existing);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.create({
          data: { jobId, status: ConversationStatus.PENDING },
          select: { id: true },
        });
        await tx.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            senderRole: ConversationSender.SYSTEM,
            type: ConversationMessageType.SERVICE_REQUEST,
            metadata: {
              service: job.serviceCategory?.name ?? job.otherServiceName,
              description: job.description,
              locationAddress: job.locationAddress,
              latitude: job.latitude,
              longitude: job.longitude,
            },
          },
        });
        await this.audit.log(
          {
            entityType: 'Conversation',
            entityId: conversation.id,
            action: 'CONVERSATION_OPENED',
            actorId: userId,
            toStatus: ConversationStatus.PENDING,
            metadata: { jobId },
          },
          tx,
        );
      });
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
        throw new ConflictException('This job request has already been answered.');
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
        throw new ConflictException('This job request has already been answered.');
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
  async postMessage(userId: string, conversationId: string, dto: PostMessageDto) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    this.assertNegotiating(conversation.status);

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

    return this.get(userId, conversationId);
  }

  /** Accepts the outstanding offer, agreeing the price and closing the chat. */
  async acceptOffer(
    userId: string,
    conversationId: string,
    offerId: string,
  ) {
    const conversation = await this.find(conversationId);
    const role = this.assertParticipant(conversation, userId);
    await this.expireStaleOffers(conversationId);
    const current = await this.find(conversationId);
    this.assertNegotiating(current.status);

    const offer = this.requireOffer(current, offerId);
    if (offer.status !== PriceOfferStatus.PENDING) {
      throw new ConflictException('This offer is no longer awaiting a response.');
    }
    if (isOfferExpired(offer.expiresAt)) {
      await this.expireStaleOffers(conversationId);
      throw new ConflictException('This offer has expired.');
    }
    if (!canRespondToOffer(offer.senderRole, role)) {
      throw new ForbiddenException('You cannot respond to your own offer.');
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
      await tx.conversationMessage.create({
        data: {
          conversationId,
          senderRole: ConversationSender.SYSTEM,
          type: ConversationMessageType.SYSTEM,
          text: `Agreed at ${offer.amount} ${offer.currency}.`,
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

    return this.get(userId, conversationId);
  }

  /** Declines the outstanding offer, ending the negotiation. */
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

    const offer = this.requireOffer(current, offerId);
    if (offer.status !== PriceOfferStatus.PENDING) {
      throw new ConflictException('This offer is no longer awaiting a response.');
    }
    if (isOfferExpired(offer.expiresAt)) {
      await this.expireStaleOffers(conversationId);
      throw new ConflictException('This offer has expired.');
    }
    if (!canRespondToOffer(offer.senderRole, role)) {
      throw new ForbiddenException('You cannot respond to your own offer.');
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
        data: {
          status: ConversationStatus.DECLINED,
          declinedById: userId,
          declineReason: reason,
          lastMessageAt: now,
          closedAt: now,
        },
      });
      await tx.conversationMessage.create({
        data: {
          conversationId,
          senderRole: ConversationSender.SYSTEM,
          type: ConversationMessageType.SYSTEM,
          text: reason
            ? `Offer declined: ${reason}`
            : 'Offer declined.',
        },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversationId,
          action: 'CONVERSATION_DECLINED',
          actorId: userId,
          fromStatus: ConversationStatus.NEGOTIATING,
          toStatus: ConversationStatus.DECLINED,
          metadata: { offerId: offer.id, reason },
        },
        tx,
      );
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

  private assertPending(status: ConversationStatus): void {
    if (status !== ConversationStatus.PENDING) {
      throw new ConflictException('This job request has already been answered.');
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

  /**
   * Reopens a conversation whose job request a previous technician declined,
   * once job-core has assigned a new one. A system line records the restart;
   * the closed history stays intact.
   */
  private async reopenForTechnician(
    conversation: ConversationWithDetails,
    actorId: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const reopened = await tx.conversation.updateMany({
        where: { id: conversation.id, status: ConversationStatus.DECLINED },
        data: {
          status: ConversationStatus.PENDING,
          declinedById: null,
          declineReason: null,
          closedAt: null,
          lastMessageAt: now,
        },
      });
      if (!reopened.count) return; // Another caller reopened or answered first.
      await tx.conversationMessage.create({
        data: {
          conversationId: conversation.id,
          senderRole: ConversationSender.SYSTEM,
          type: ConversationMessageType.SYSTEM,
          text: 'The job request was reopened for a new technician.',
        },
      });
      await this.audit.log(
        {
          entityType: 'Conversation',
          entityId: conversation.id,
          action: 'CONVERSATION_REOPENED',
          actorId,
          fromStatus: ConversationStatus.DECLINED,
          toStatus: ConversationStatus.PENDING,
          metadata: { jobId: conversation.jobId },
        },
        tx,
      );
    });
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
    const sideOffers = conversation.messages.filter(
      (message) => message.offer?.senderRole === role,
    ).length;
    if (sideOffers >= CONVERSATION_MAX_OFFERS_PER_SIDE) {
      throw new ConflictException(
        'You have reached your offer limit for this negotiation.',
      );
    }
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
