import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationMessageType,
  ConversationSender,
  ConversationStatus,
  PriceOfferStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { ConversationsService } from './conversations.service';

// The Prisma mock is intentionally loosely typed so each test can shape only the
// fields it exercises.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

const CUSTOMER_USER = 'cust-user';
const TECHNICIAN_USER = 'tech-user';

function buildJob(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: 'job1',
    customerId: CUSTOMER_USER,
    technicianId: 'tech1',
    description: 'Air conditioner makes a loud noise',
    locationAddress: 'Kimihurura, Kigali',
    latitude: -1.95,
    longitude: 30.06,
    otherServiceName: null,
    serviceCategory: { name: 'HVAC' },
    technician: { userId: TECHNICIAN_USER },
    ...overrides,
  };
}

function buildConversation(overrides: AnyRecord = {}): AnyRecord {
  return {
    id: 'conv1',
    jobId: 'job1',
    status: ConversationStatus.NEGOTIATING,
    currency: 'RWF',
    agreedAmount: null,
    offerCount: 0,
    declinedById: null,
    declineReason: null,
    startedAt: new Date('2026-10-16T12:00:00.000Z'),
    lastMessageAt: new Date('2026-10-16T12:00:00.000Z'),
    closedAt: null,
    job: {
      id: 'job1',
      customerId: CUSTOMER_USER,
      technicianId: 'tech1',
      description: 'Air conditioner makes a loud noise',
      locationAddress: 'Kimihurura, Kigali',
      latitude: -1.95,
      longitude: 30.06,
      otherServiceName: null,
      customer: {
        id: CUSTOMER_USER,
        fullName: 'Jean',
        phoneNumber: '+250733762239',
      },
      serviceCategory: { id: 'cat1', name: 'HVAC', slug: 'hvac' },
      technician: {
        id: 'tech1',
        userId: TECHNICIAN_USER,
        user: {
          id: TECHNICIAN_USER,
          fullName: 'Christian',
          phoneNumber: '+250736202068',
        },
      },
    },
    messages: [],
    ...overrides,
  };
}

function buildOfferMessage(offerOverrides: AnyRecord = {}): AnyRecord {
  const createdAt = new Date('2026-10-16T12:01:00.000Z');
  return {
    id: 'msg-offer',
    senderId: TECHNICIAN_USER,
    senderRole: ConversationSender.TECHNICIAN,
    type: 'PRICE_OFFER',
    text: null,
    metadata: null,
    createdAt,
    offer: {
      id: 'offer1',
      conversationId: 'conv1',
      messageId: 'msg-offer',
      amount: 25000,
      currency: 'RWF',
      senderRole: ConversationSender.TECHNICIAN,
      status: PriceOfferStatus.PENDING,
      notes: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      respondedAt: null,
      createdAt,
      ...offerOverrides,
    },
  };
}

function createService(initialConversation: AnyRecord | null) {
  let stored = initialConversation;
  const prisma: AnyRecord = {
    job: { findUnique: jest.fn().mockResolvedValue(buildJob()) },
    conversation: {
      findUnique: jest.fn(({ where }: AnyRecord) =>
        Promise.resolve(
          where.jobId
            ? stored
            : stored && stored.id === where.id
              ? stored
              : null,
        ),
      ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(() => {
        stored = buildConversation({
          messages: [],
          status: ConversationStatus.PENDING,
        });
        return Promise.resolve({ id: 'conv1' });
      }),
      update: jest.fn().mockResolvedValue({}),
      // Reflects the update on the stored conversation so follow-up reads in
      // the service see the new status, like the real database would.
      updateMany: jest.fn().mockImplementation(({ data }: AnyRecord) => {
        if (stored) Object.assign(stored, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    conversationMessage: { create: jest.fn().mockResolvedValue({ id: 'msg' }) },
    priceOffer: {
      create: jest.fn().mockResolvedValue({ id: 'offer-new' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(prisma)
      : Promise.all(arg as Promise<unknown>[]),
  );
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const jobs = { dropJob: jest.fn().mockResolvedValue({ message: 'dropped' }) };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const service = new ConversationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    jobs as unknown as JobsService,
    notifications as any,
  );
  return { service, prisma, audit, jobs, notifications };
}

describe('ConversationsService', () => {
  describe('open', () => {
    it('creates the conversation with an automatic service request', async () => {
      const { service, prisma } = createService(null);

      const result = await service.open(CUSTOMER_USER, 'job1');

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { jobId: 'job1', status: ConversationStatus.PENDING },
        select: { id: true },
      });
      expect(prisma.conversationMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          senderRole: ConversationSender.SYSTEM,
          type: 'SERVICE_REQUEST',
          metadata: expect.objectContaining({ service: 'HVAC' }),
        }),
      });
      expect(result.id).toBe('conv1');
      expect(result.status).toBe(ConversationStatus.PENDING);
    });

    it('returns the existing conversation without creating another', async () => {
      const { service, prisma } = createService(buildConversation());

      const result = await service.open(CUSTOMER_USER, 'job1');

      expect(result.id).toBe('conv1');
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('rejects a job the caller does not own', async () => {
      const { service, prisma } = createService(null);
      prisma.job.findUnique.mockResolvedValue(buildJob({ customerId: 'other' }));

      await expect(service.open(CUSTOMER_USER, 'job1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuses jobs with no assigned technician', async () => {
      const { service, prisma } = createService(null);
      prisma.job.findUnique.mockResolvedValue(
        buildJob({ technicianId: null, technician: null }),
      );

      await expect(service.open(CUSTOMER_USER, 'job1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('get', () => {
    it('hides the conversation from non-participants', async () => {
      const { service } = createService(buildConversation());

      await expect(service.get('stranger', 'conv1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('expires lapsed offers before returning', async () => {
      const conversation = buildConversation({
        offerCount: 1,
        messages: [
          buildOfferMessage({
            expiresAt: new Date('2026-10-15T12:01:00.000Z'),
          }),
        ],
      });
      const { service, prisma } = createService(conversation);
      prisma.priceOffer.findMany.mockResolvedValue([{ id: 'offer1' }]);

      await service.get(CUSTOMER_USER, 'conv1');

      expect(prisma.priceOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'offer1', status: PriceOfferStatus.PENDING },
        data: expect.objectContaining({ status: PriceOfferStatus.EXPIRED }),
      });
    });
  });

  describe('postMessage', () => {
    it('refuses chat before the technician accepts the request', async () => {
      const { service } = createService(
        buildConversation({ status: ConversationStatus.PENDING }),
      );

      await expect(
        service.postMessage(CUSTOMER_USER, 'conv1', { text: 'Hello' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('acceptJobRequest', () => {
    it('lets the assigned technician accept and opens the negotiation', async () => {
      const { service, prisma } = createService(
        buildConversation({ status: ConversationStatus.PENDING }),
      );

      const result = await service.acceptJobRequest(TECHNICIAN_USER, 'conv1');

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv1', status: ConversationStatus.PENDING },
        data: expect.objectContaining({
          status: ConversationStatus.NEGOTIATING,
        }),
      });
      expect(prisma.conversationMessage.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          senderId: TECHNICIAN_USER,
          senderRole: ConversationSender.TECHNICIAN,
          type: ConversationMessageType.TECHNICIAN_RESPONSE,
          metadata: { decision: 'ACCEPTED' },
        }),
      });
      expect(result.status).toBe(ConversationStatus.NEGOTIATING);
    });

    it('forbids the customer from accepting', async () => {
      const { service } = createService(
        buildConversation({ status: ConversationStatus.PENDING }),
      );

      await expect(
        service.acceptJobRequest(CUSTOMER_USER, 'conv1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an already-answered request', async () => {
      const { service, prisma } = createService(
        buildConversation({ status: ConversationStatus.PENDING }),
      );
      prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.acceptJobRequest(TECHNICIAN_USER, 'conv1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a request that is no longer pending', async () => {
      const { service } = createService(
        buildConversation({ status: ConversationStatus.NEGOTIATING }),
      );

      await expect(
        service.acceptJobRequest(TECHNICIAN_USER, 'conv1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('declineJobRequest', () => {
    it('closes the conversation and hands the job back to job-core', async () => {
      const { service, prisma, jobs } = createService(
        buildConversation({ status: ConversationStatus.PENDING }),
      );

      const result = await service.declineJobRequest(
        TECHNICIAN_USER,
        'conv1',
        { reason: 'Too far away' },
      );

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv1', status: ConversationStatus.PENDING },
        data: expect.objectContaining({
          status: ConversationStatus.DECLINED,
          declinedById: TECHNICIAN_USER,
          declineReason: 'Too far away',
        }),
      });
      expect(jobs.dropJob).toHaveBeenCalledWith(TECHNICIAN_USER, 'job1', {
        reason: 'Too far away',
      });
      expect(result.status).toBe(ConversationStatus.DECLINED);
    });

    it('forbids the customer from declining', async () => {
      const { service, jobs } = createService(
        buildConversation({ status: ConversationStatus.PENDING }),
      );

      await expect(
        service.declineJobRequest(CUSTOMER_USER, 'conv1', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(jobs.dropJob).not.toHaveBeenCalled();
    });

    it('rejects an already-answered request', async () => {
      const { service, prisma, jobs } = createService(
        buildConversation({ status: ConversationStatus.PENDING }),
      );
      prisma.conversation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.declineJobRequest(TECHNICIAN_USER, 'conv1', {}),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(jobs.dropJob).not.toHaveBeenCalled();
    });
  });

  describe('open after a job-request decline', () => {
    it('reopens the conversation for a newly assigned technician', async () => {
      const declined = buildConversation({
        status: ConversationStatus.DECLINED,
        declinedById: TECHNICIAN_USER,
        declineReason: 'Too far away',
        closedAt: new Date('2026-10-16T12:30:00.000Z'),
        messages: [
          {
            id: 'msg-resp',
            senderId: TECHNICIAN_USER,
            senderRole: ConversationSender.TECHNICIAN,
            type: 'TECHNICIAN_RESPONSE',
            text: null,
            metadata: { decision: 'DECLINED', reason: 'Too far away' },
            createdAt: new Date('2026-10-16T12:30:00.000Z'),
            offer: null,
          },
        ],
      });
      const { service, prisma } = createService(declined);
      prisma.job.findUnique.mockResolvedValue(
        buildJob({ technician: { userId: 'tech-user-2' } }),
      );

      const result = await service.open(CUSTOMER_USER, 'job1');

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { id: 'conv1', status: ConversationStatus.DECLINED },
        data: expect.objectContaining({
          status: ConversationStatus.PENDING,
          declinedById: null,
          declineReason: null,
          closedAt: null,
        }),
      });
      expect(result.status).toBe(ConversationStatus.PENDING);
    });

    it('keeps the conversation closed when the same technician is still assigned', async () => {
      const declined = buildConversation({
        status: ConversationStatus.DECLINED,
        messages: [
          {
            id: 'msg-resp',
            senderId: TECHNICIAN_USER,
            senderRole: ConversationSender.TECHNICIAN,
            type: 'TECHNICIAN_RESPONSE',
            text: null,
            metadata: { decision: 'DECLINED' },
            createdAt: new Date('2026-10-16T12:30:00.000Z'),
            offer: null,
          },
        ],
      });
      const { service, prisma } = createService(declined);

      const result = await service.open(CUSTOMER_USER, 'job1');

      expect(prisma.conversation.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe(ConversationStatus.DECLINED);
    });
  });

  describe('createOffer', () => {
    it('supersedes the outstanding offer and records the new one', async () => {
      const conversation = buildConversation({
        offerCount: 1,
        messages: [buildOfferMessage()],
      });
      const { service, prisma } = createService(conversation);

      await service.createOffer(CUSTOMER_USER, 'conv1', { amount: 30000 });

      expect(prisma.priceOffer.update).toHaveBeenCalledWith({
        where: { id: 'offer1' },
        data: expect.objectContaining({ status: PriceOfferStatus.SUPERSEDED }),
      });
      expect(prisma.priceOffer.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amount: 30000,
          senderRole: ConversationSender.CUSTOMER,
          status: PriceOfferStatus.PENDING,
        }),
        select: { id: true },
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv1' },
        data: expect.objectContaining({ offerCount: { increment: 1 } }),
      });
    });

    it('rejects an unchanged amount', async () => {
      const conversation = buildConversation({
        offerCount: 1,
        messages: [buildOfferMessage()],
      });
      const { service } = createService(conversation);

      await expect(
        service.createOffer(CUSTOMER_USER, 'conv1', { amount: 25000 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects offers once the overall limit is reached', async () => {
      const conversation = buildConversation({ offerCount: 6 });
      const { service } = createService(conversation);

      await expect(
        service.createOffer(CUSTOMER_USER, 'conv1', { amount: 30000 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a closed negotiation', async () => {
      const conversation = buildConversation({
        status: ConversationStatus.AGREED,
      });
      const { service } = createService(conversation);

      await expect(
        service.createOffer(CUSTOMER_USER, 'conv1', { amount: 30000 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('acceptOffer', () => {
    it('agrees the price and closes the conversation', async () => {
      const conversation = buildConversation({
        offerCount: 1,
        messages: [buildOfferMessage()],
      });
      const { service, prisma } = createService(conversation);

      await service.acceptOffer(CUSTOMER_USER, 'conv1', 'offer1');

      expect(prisma.priceOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'offer1', status: PriceOfferStatus.PENDING },
        data: expect.objectContaining({ status: PriceOfferStatus.ACCEPTED }),
      });
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv1' },
        data: expect.objectContaining({
          status: ConversationStatus.AGREED,
          agreedAmount: 25000,
        }),
      });
    });

    it('forbids responding to your own offer', async () => {
      const conversation = buildConversation({
        offerCount: 1,
        messages: [buildOfferMessage()],
      });
      const { service } = createService(conversation);

      await expect(
        service.acceptOffer(TECHNICIAN_USER, 'conv1', 'offer1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an unknown offer', async () => {
      const conversation = buildConversation({
        offerCount: 1,
        messages: [buildOfferMessage()],
      });
      const { service } = createService(conversation);

      await expect(
        service.acceptOffer(CUSTOMER_USER, 'conv1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('declineOffer', () => {
    it('ends the negotiation with the reason recorded', async () => {
      const conversation = buildConversation({
        offerCount: 1,
        messages: [buildOfferMessage()],
      });
      const { service, prisma } = createService(conversation);

      await service.declineOffer(CUSTOMER_USER, 'conv1', 'offer1', {
        reason: 'Too expensive',
      });

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv1' },
        data: expect.objectContaining({
          status: ConversationStatus.DECLINED,
          declinedById: CUSTOMER_USER,
          declineReason: 'Too expensive',
        }),
      });
    });
  });

  describe('listForUser', () => {
    it('scopes the list to the caller as customer or technician', async () => {
      const { service, prisma } = createService(buildConversation());
      prisma.conversation.findMany.mockResolvedValue([buildConversation()]);
      prisma.conversation.count.mockResolvedValue(1);

      const result = await service.listForUser(CUSTOMER_USER, { page: 1 });

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { job: { is: { customerId: CUSTOMER_USER } } },
              { job: { is: { technician: { is: { userId: CUSTOMER_USER } } } } },
            ],
          },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });
  });

  describe('listForAdmin', () => {
    it('applies the status filter and paginates', async () => {
      const { service, prisma } = createService(buildConversation());
      prisma.conversation.findMany.mockResolvedValue([buildConversation()]);
      prisma.conversation.count.mockResolvedValue(1);

      const result = await service.listForAdmin({
        status: ConversationStatus.NEGOTIATING,
        page: 2,
        limit: 10,
      });

      expect(prisma.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ConversationStatus.NEGOTIATING },
          skip: 10,
          take: 10,
        }),
      );
      expect(result.pagination).toEqual({
        page: 2,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(result.data).toHaveLength(1);
    });
  });
});
