import {
  ChatMessageType,
  ChatRoomStatus,
  ChatSenderRole,
  JobCooperationStatus,
  JobStatus,
  UserRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatService } from './chat.service';

const ownerId = 'customer-1';
const technicianUserId = 'technician-user-1';
const roomId = 'room-1';
const jobId = 'job-1';
const technicianProfileId = 'technician-profile-1';
const now = new Date();

function makeRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: roomId,
    jobId,
    status: ChatRoomStatus.ACTIVE,
    disabledAt: null,
    disabledReason: null,
    createdAt: now,
    updatedAt: now,
    job: {
      id: jobId,
      customerId: ownerId,
      technicianId: technicianProfileId,
      status: JobStatus.ASSIGNED,
      cooperationStatus: JobCooperationStatus.PENDING,
      description: 'Repair the water tap.',
      serviceCategory: { name: 'Plumbing' },
      otherServiceName: null,
      customer: { id: ownerId, fullName: 'Customer' },
    },
    assignmentHistory: {
      id: 'assignment-1',
      technicianId: technicianProfileId,
      endedAt: null,
      technician: {
        userId: technicianUserId,
        user: { id: technicianUserId, fullName: 'Technician' },
      },
    },
    members: [
      {
        id: 'owner-membership',
        userId: ownerId,
        role: UserRole.CUSTOMER,
        blockedAt: null,
        blockReason: null,
        archivedAt: null,
      },
      {
        id: 'technician-membership',
        userId: technicianUserId,
        role: UserRole.TECHNICIAN,
        blockedAt: null,
        blockReason: null,
        archivedAt: null,
      },
    ],
    ...overrides,
  };
}

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'message-1',
    roomId,
    senderId: ownerId,
    senderRole: ChatSenderRole.CUSTOMER,
    type: ChatMessageType.TEXT,
    text: 'Hello technician',
    objectKey: null,
    mimeType: null,
    originalFileName: null,
    sizeBytes: null,
    durationSeconds: null,
    editedAt: null,
    deletedAt: null,
    deletedById: null,
    isTombstone: false,
    blockedAt: null,
    blockedById: null,
    blockReason: null,
    createdAt: now,
    updatedAt: now,
    reads: [],
    ...overrides,
  };
}

function createHarness(room = makeRoom()) {
  const createdMessage = makeMessage();
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    chatRoom: {
      findUnique: jest.fn().mockResolvedValue(room),
      update: jest.fn().mockResolvedValue(room),
    },
    chatRoomMember: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: 'technician-membership',
          role: UserRole.TECHNICIAN,
        }),
      update: jest.fn().mockResolvedValue({
        roomId,
        userId: technicianUserId,
        role: UserRole.TECHNICIAN,
        blockedAt: now,
        blockReason: 'Policy review',
      }),
    },
    chatMessage: {
      create: jest.fn().mockResolvedValue(createdMessage),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    chatMessageRead: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
    chatRoom: { findUnique: jest.fn().mockResolvedValue(room) },
    chatRoomMember: {
      update: jest.fn().mockResolvedValue({ id: 'owner-membership' }),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    getDownloadUrl: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const jobs = {};
  const realtime = {
    publish: jest.fn(),
    removeUserFromRoom: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ChatService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
    jobs as unknown as JobsService,
    realtime as unknown as ChatRealtimeService,
  );
  return { service, prisma, tx, audit, storage, realtime, createdMessage };
}

describe('ChatService', () => {
  it('persists and broadcasts a message from an assigned room participant', async () => {
    const { service, tx, audit, realtime } = createHarness();

    await expect(
      service.postText(
        ownerId,
        UserRole.CUSTOMER,
        roomId,
        '  Hello technician  ',
      ),
    ).resolves.toMatchObject({
      id: 'message-1',
      text: 'Hello technician',
      readByOtherSide: false,
    });

    expect(tx.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId,
          senderId: ownerId,
          type: ChatMessageType.TEXT,
          text: 'Hello technician',
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CHAT_MESSAGE_SENT' }),
      tx,
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      roomId,
      'chat:message:new',
      expect.objectContaining({ id: 'message-1' }),
    );
  });

  it('rejects member messages after the room is disabled', async () => {
    const disabledRoom = makeRoom({ status: ChatRoomStatus.DISABLED });
    const { service, tx } = createHarness(disabledRoom);

    await expect(
      service.postText(ownerId, UserRole.CUSTOMER, roomId, 'Hello'),
    ).rejects.toThrow('This chat room is disabled.');
    expect(tx.chatMessage.create).not.toHaveBeenCalled();
  });

  it('does not allow a sender to edit a message after the recipient reads it', async () => {
    const { service, tx } = createHarness();
    tx.chatMessage.findFirst.mockResolvedValue(
      makeMessage({ reads: [{ userId: technicianUserId, readAt: now }] }),
    );

    await expect(
      service.editText(
        ownerId,
        UserRole.CUSTOMER,
        roomId,
        'message-1',
        'Updated',
      ),
    ).rejects.toThrow('A message cannot be edited after it is seen.');
    expect(tx.chatMessage.update).not.toHaveBeenCalled();
  });

  it('does not let administrator inspection create a member read receipt', async () => {
    const { service, prisma, tx } = createHarness();

    await expect(
      service.markRead('admin-1', UserRole.ADMIN, roomId, 'message-1'),
    ).rejects.toThrow('Administrators cannot create member read receipts.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.chatMessageRead.createMany).not.toHaveBeenCalled();
  });

  it('removes a blocked member from connected realtime room sockets', async () => {
    const { service, realtime } = createHarness();

    await service.setMemberBlocked(
      'admin-1',
      roomId,
      technicianUserId,
      true,
      'Policy review',
    );

    expect(realtime.removeUserFromRoom).toHaveBeenCalledWith(
      technicianUserId,
      roomId,
    );
  });
});
