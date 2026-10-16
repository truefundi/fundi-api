import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ConversationSender,
  ConversationStatus,
  PriceOfferStatus,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
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
      expiresAt: new Date('2026-10-17T12:01:00.000Z'),
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
        stored = buildConversation({ messages: [] });
        return Promise.resolve({ id: 'conv1' });
      }),
      update: jest.fn().mockResolvedValue({}),
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
  const service = new ConversationsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, prisma, audit };
}

describe('ConversationsService', () => {
  describe('open', () => {
    it('creates the conversation with an automatic service request', async () => {
      const { service, prisma } = createService(null);

      const result = await service.open(CUSTOMER_USER, 'job1');

      expect(prisma.conversation.create).toHaveBeenCalledWith({
        data: { jobId: 'job1' },
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
      expect(result.status).toBe(ConversationStatus.NEGOTIATING);
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
