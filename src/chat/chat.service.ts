import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import {
  ChatMessageType,
  ChatRoomStatus,
  ChatSenderRole,
  JobProgressStatus,
  JobStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../database/prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { ChatRealtimeService } from './chat-realtime.service';
import { CHAT_MEDIA_DOWNLOAD_TTL_SECONDS } from './chat.constants';
import {
  ChatUpload,
  safeChatFileName,
  validateChatUpload,
} from './chat-media.util';

const CHAT_ROOM_INCLUDE = {
  job: {
    select: {
      id: true,
      customerId: true,
      technicianId: true,
      status: true,
      cooperationStatus: true,
      description: true,
      serviceCategory: { select: { name: true } },
      otherServiceName: true,
      customer: { select: { id: true, fullName: true } },
    },
  },
  assignmentHistory: {
    select: {
      id: true,
      technicianId: true,
      endedAt: true,
      technician: {
        select: {
          userId: true,
          user: { select: { id: true, fullName: true } },
        },
      },
    },
  },
  members: {
    select: {
      id: true,
      userId: true,
      role: true,
      blockedAt: true,
      blockReason: true,
      archivedAt: true,
    },
  },
} satisfies Prisma.ChatRoomInclude;

type ChatRoomDetails = Prisma.ChatRoomGetPayload<{
  include: typeof CHAT_ROOM_INCLUDE;
}>;

const CHAT_MESSAGE_INCLUDE = {
  reads: { select: { userId: true, readAt: true } },
} satisfies Prisma.ChatMessageInclude;

type ChatMessageDetails = Prisma.ChatMessageGetPayload<{
  include: typeof CHAT_MESSAGE_INCLUDE;
}>;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  async listForMember(userId: string) {
    const memberships = await this.prisma.chatRoomMember.findMany({
      where: { userId, archivedAt: null, blockedAt: null },
      include: { room: { include: CHAT_ROOM_INCLUDE } },
      orderBy: [{ room: { updatedAt: 'desc' } }, { roomId: 'asc' }],
    });
    return memberships.map(({ room, ...membership }) =>
      this.roomResponse(room, membership),
    );
  }

  async getForMember(userId: string, role: UserRole, roomId: string) {
    const room = await this.findRoom(roomId);
    const member = this.assertCanRead(room, userId, role);
    return this.roomResponse(room, member ?? undefined);
  }

  async listForAdmin() {
    const rooms = await this.prisma.chatRoom.findMany({
      include: CHAT_ROOM_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    return rooms.map((room) => this.roomResponse(room, undefined, true));
  }

  async getForAdmin(roomId: string) {
    return this.roomResponse(await this.findRoom(roomId), undefined, true);
  }

  async listMessages(
    userId: string,
    role: UserRole,
    roomId: string,
    limit: number,
    beforeMessageId?: string,
  ) {
    const room = await this.findRoom(roomId);
    const member = this.assertCanRead(room, userId, role);
    if (member?.archivedAt) throw new NotFoundException('Chat room not found.');

    let cursor: { id: string } | undefined;
    if (beforeMessageId) {
      const before = await this.prisma.chatMessage.findFirst({
        where: { id: beforeMessageId, roomId },
        select: { id: true },
      });
      if (!before) throw new NotFoundException('Chat message not found.');
      cursor = before;
    }
    const messages = await this.prisma.chatMessage.findMany({
      where: { roomId },
      include: CHAT_MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    return {
      items: await Promise.all(
        messages.map((message) =>
          this.messageResponse(message, userId, role === UserRole.ADMIN),
        ),
      ),
      nextCursor:
        messages.length === limit ? messages[messages.length - 1].id : null,
    };
  }

  async postText(userId: string, role: UserRole, roomId: string, text: string) {
    const body = text.trim();
    if (!body || body.length > 4_000) {
      throw new BadRequestException(
        'Text messages must contain 1 to 4000 characters.',
      );
    }
    const message = await this.prisma.$transaction(async (tx) => {
      await this.lockRoomJob(tx, roomId);
      const room = await this.findRoomWith(tx, roomId);
      this.assertCanWrite(room, userId, role);
      const created = await tx.chatMessage.create({
        data: {
          roomId,
          senderId: userId,
          senderRole: this.senderRole(role),
          type:
            role === UserRole.ADMIN
              ? ChatMessageType.SYSTEM
              : ChatMessageType.TEXT,
          text: body,
        },
        include: CHAT_MESSAGE_INCLUDE,
      });
      await tx.chatRoom.update({
        where: { id: roomId },
        data: { updatedAt: new Date() },
      });
      await this.audit.log(
        {
          entityType: 'ChatMessage',
          entityId: created.id,
          action:
            role === UserRole.ADMIN
              ? 'ADMIN_CHAT_MESSAGE_SENT'
              : 'CHAT_MESSAGE_SENT',
          actorId: userId,
          metadata: { roomId, messageType: created.type },
        },
        tx,
      );
      return created;
    });
    const response = await this.messageResponse(
      message,
      userId,
      role === UserRole.ADMIN,
    );
    this.realtime.publish(roomId, 'chat:message:new', response);
    return response;
  }

  async postMedia(
    userId: string,
    role: UserRole,
    roomId: string,
    type: ChatMessageType,
    upload: ChatUpload,
    durationSeconds?: number,
  ) {
    const room = await this.findRoom(roomId);
    this.assertCanWrite(room, userId, role);
    const validated = validateChatUpload(upload, type, durationSeconds);
    const objectKey = `chat/${roomId}/${randomUUID()}.${validated.extension}`;
    await this.storage.put(objectKey, upload.buffer, validated.mimeType);
    let message: ChatMessageDetails;
    try {
      message = await this.prisma.$transaction(async (tx) => {
        await this.lockRoomJob(tx, roomId);
        const current = await this.findRoomWith(tx, roomId);
        this.assertCanWrite(current, userId, role);
        const created = await tx.chatMessage.create({
          data: {
            roomId,
            senderId: userId,
            senderRole: this.senderRole(role),
            type,
            objectKey,
            mimeType: validated.mimeType,
            originalFileName: safeChatFileName(upload.originalname),
            sizeBytes: validated.sizeBytes,
            durationSeconds: validated.durationSeconds,
          },
          include: CHAT_MESSAGE_INCLUDE,
        });
        await tx.chatRoom.update({
          where: { id: roomId },
          data: { updatedAt: new Date() },
        });
        await this.audit.log(
          {
            entityType: 'ChatMessage',
            entityId: created.id,
            action: 'CHAT_MEDIA_SENT',
            actorId: userId,
            metadata: {
              roomId,
              messageType: type,
              mimeType: validated.mimeType,
              sizeBytes: validated.sizeBytes,
            },
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      try {
        await this.storage.delete(objectKey);
      } catch (cleanupError) {
        this.logger.error(
          `Could not remove chat upload ${objectKey}: ${this.errorMessage(cleanupError)}`,
        );
      }
      throw error;
    }
    const response = await this.messageResponse(
      message,
      userId,
      role === UserRole.ADMIN,
    );
    this.realtime.publish(roomId, 'chat:message:new', response);
    return response;
  }

  async downloadMedia(
    userId: string,
    role: UserRole,
    roomId: string,
    messageId: string,
  ) {
    const room = await this.findRoom(roomId);
    const member = this.assertCanRead(room, userId, role);
    if (member?.archivedAt)
      throw new NotFoundException('Chat message not found.');
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, roomId },
    });
    if (
      !message?.objectKey ||
      message.isTombstone ||
      (message.blockedAt && role !== UserRole.ADMIN)
    ) {
      throw new NotFoundException('Chat attachment not found.');
    }
    const file = await this.storage.get(message.objectKey);
    const name = safeChatFileName(message.originalFileName ?? 'attachment');
    return new StreamableFile(file, {
      type: message.mimeType ?? 'application/octet-stream',
      length: file.length,
      disposition: `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
  }

  async markRead(
    userId: string,
    role: UserRole,
    roomId: string,
    messageId: string,
  ) {
    if (role === UserRole.ADMIN) {
      throw new ForbiddenException(
        'Administrators cannot create member read receipts.',
      );
    }
    const marked = await this.prisma.$transaction(async (tx) => {
      const room = await this.findRoomWith(tx, roomId);
      this.assertCanRead(room, userId, role);
      const target = await tx.chatMessage.findFirst({
        where: { id: messageId, roomId },
        select: { id: true, createdAt: true },
      });
      if (!target) throw new NotFoundException('Chat message not found.');
      await tx.$queryRaw`
        SELECT "id" FROM "chat_messages"
        WHERE "roomId" = ${roomId}
          AND "senderId" <> ${userId}
          AND "createdAt" <= ${target.createdAt}
          AND "isTombstone" = false
          AND "blockedAt" IS NULL
        ORDER BY "id"
        FOR UPDATE`;
      const incoming = await tx.chatMessage.findMany({
        where: {
          roomId,
          senderId: { not: userId },
          createdAt: { lte: target.createdAt },
          isTombstone: false,
          blockedAt: null,
          reads: { none: { userId } },
        },
        select: { id: true },
      });
      const readAt = new Date();
      if (incoming.length) {
        await tx.chatMessageRead.createMany({
          data: incoming.map(({ id }) => ({ messageId: id, userId, readAt })),
          skipDuplicates: true,
        });
      }
      return { userId, messageId, readAt, count: incoming.length };
    });
    this.realtime.publish(roomId, 'chat:message:read', marked);
    return marked;
  }

  async editText(
    userId: string,
    role: UserRole,
    roomId: string,
    messageId: string,
    text: string,
  ) {
    const message = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "chat_messages" WHERE "id" = ${messageId} FOR UPDATE`;
      const current = await tx.chatMessage.findFirst({
        where: { id: messageId, roomId },
        include: CHAT_MESSAGE_INCLUDE,
      });
      if (!current) throw new NotFoundException('Chat message not found.');
      await this.lockRoomJob(tx, roomId);
      const room = await this.findRoomWith(tx, roomId);
      this.assertCanWrite(room, userId, role);
      if (
        current.senderId !== userId ||
        current.type !== ChatMessageType.TEXT ||
        current.isTombstone ||
        current.blockedAt
      ) {
        throw new ConflictException(
          'Only your visible text messages can be edited.',
        );
      }
      if (current.reads.some((receipt) => receipt.userId !== userId)) {
        throw new ConflictException(
          'A message cannot be edited after it is seen.',
        );
      }
      const updated = await tx.chatMessage.update({
        where: { id: messageId },
        data: { text: text.trim(), editedAt: new Date() },
        include: CHAT_MESSAGE_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'ChatMessage',
          entityId: messageId,
          action: 'CHAT_MESSAGE_EDITED',
          actorId: userId,
          metadata: { roomId },
        },
        tx,
      );
      return updated;
    });
    const response = await this.messageResponse(message, userId);
    this.realtime.publish(roomId, 'chat:message:updated', response);
    return response;
  }

  async deleteUnreadMessage(
    userId: string,
    role: UserRole,
    roomId: string,
    messageId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "chat_messages" WHERE "id" = ${messageId} FOR UPDATE`;
      const current = await tx.chatMessage.findFirst({
        where: { id: messageId, roomId },
        include: CHAT_MESSAGE_INCLUDE,
      });
      if (!current) throw new NotFoundException('Chat message not found.');
      await this.lockRoomJob(tx, roomId);
      const room = await this.findRoomWith(tx, roomId);
      this.assertCanWrite(room, userId, role);
      if (current.senderId !== userId || current.isTombstone) {
        throw new ConflictException(
          'Only your visible messages can be deleted.',
        );
      }
      if (current.reads.some((receipt) => receipt.userId !== userId)) {
        throw new ConflictException(
          'A message cannot be deleted after it is seen.',
        );
      }
      const objectKey = current.objectKey;
      const updated = await tx.chatMessage.update({
        where: { id: messageId },
        data: {
          text: null,
          objectKey: null,
          mimeType: null,
          originalFileName: null,
          sizeBytes: null,
          durationSeconds: null,
          deletedAt: new Date(),
          deletedById: userId,
          isTombstone: true,
        },
        include: CHAT_MESSAGE_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'ChatMessage',
          entityId: messageId,
          action: 'CHAT_MESSAGE_TOMBSTONED',
          actorId: userId,
          metadata: { roomId, hadAttachment: Boolean(objectKey) },
        },
        tx,
      );
      return { message: updated, objectKey };
    });
    if (result.objectKey) await this.removeStoredObject(result.objectKey);
    const response = await this.messageResponse(result.message, userId);
    this.realtime.publish(roomId, 'chat:message:deleted', response);
    return response;
  }

  async setMessageBlocked(
    adminId: string,
    roomId: string,
    messageId: string,
    blocked: boolean,
    reason?: string,
  ) {
    const message = await this.prisma.$transaction(async (tx) => {
      const current = await tx.chatMessage.findFirst({
        where: { id: messageId, roomId },
      });
      if (!current) throw new NotFoundException('Chat message not found.');
      const updated = await tx.chatMessage.update({
        where: { id: messageId },
        data: {
          blockedAt: blocked ? new Date() : null,
          blockedById: blocked ? adminId : null,
          blockReason: blocked
            ? reason?.trim() || 'Blocked by administrator.'
            : null,
        },
        include: CHAT_MESSAGE_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'ChatMessage',
          entityId: messageId,
          action: blocked ? 'CHAT_MESSAGE_BLOCKED' : 'CHAT_MESSAGE_UNBLOCKED',
          actorId: adminId,
          metadata: { roomId, reason: reason ?? null },
        },
        tx,
      );
      return updated;
    });
    const response = await this.messageResponse(message, adminId, true);
    this.realtime.publish(roomId, 'chat:message:moderated', response);
    return response;
  }

  async permanentlyDeleteMessage(
    adminId: string,
    roomId: string,
    messageId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.chatMessage.findFirst({
        where: { id: messageId, roomId },
      });
      if (!current) throw new NotFoundException('Chat message not found.');
      const objectKey = current.objectKey;
      const message = await tx.chatMessage.update({
        where: { id: messageId },
        data: {
          text: null,
          objectKey: null,
          mimeType: null,
          originalFileName: null,
          sizeBytes: null,
          durationSeconds: null,
          deletedAt: new Date(),
          deletedById: adminId,
          isTombstone: true,
        },
        include: CHAT_MESSAGE_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'ChatMessage',
          entityId: messageId,
          action: 'ADMIN_CHAT_MESSAGE_DELETED',
          actorId: adminId,
          metadata: { roomId, hadAttachment: Boolean(objectKey) },
        },
        tx,
      );
      return { message, objectKey };
    });
    if (result.objectKey) await this.removeStoredObject(result.objectKey);
    const response = await this.messageResponse(result.message, adminId, true);
    this.realtime.publish(roomId, 'chat:message:deleted', response);
    return response;
  }

  async setMemberBlocked(
    adminId: string,
    roomId: string,
    memberUserId: string,
    blocked: boolean,
    reason?: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockRoomJob(tx, roomId);
      const member = await tx.chatRoomMember.findUnique({
        where: { roomId_userId: { roomId, userId: memberUserId } },
        select: { id: true, role: true },
      });
      if (!member) throw new NotFoundException('Chat room member not found.');
      const saved = await tx.chatRoomMember.update({
        where: { id: member.id },
        data: {
          blockedAt: blocked ? new Date() : null,
          blockReason: blocked
            ? reason?.trim() || 'Blocked by administrator.'
            : null,
        },
        select: {
          roomId: true,
          userId: true,
          role: true,
          blockedAt: true,
          blockReason: true,
        },
      });
      await this.audit.log(
        {
          entityType: 'ChatRoom',
          entityId: roomId,
          action: blocked ? 'CHAT_MEMBER_BLOCKED' : 'CHAT_MEMBER_UNBLOCKED',
          actorId: adminId,
          metadata: { memberUserId, role: member.role, reason: reason ?? null },
        },
        tx,
      );
      return saved;
    });
    if (blocked) {
      await this.realtime.removeUserFromRoom(memberUserId, roomId);
    }
    this.realtime.publish(roomId, 'chat:member:moderated', updated);
    return updated;
  }

  async setRoomDisabled(
    adminId: string,
    roomId: string,
    disabled: boolean,
    reason?: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockRoomJob(tx, roomId);
      const room = await this.findRoomWith(tx, roomId);
      if (room.status === ChatRoomStatus.COMPLETED) {
        throw new ConflictException(
          'A completed job chat cannot be re-enabled.',
        );
      }
      if (
        !disabled &&
        room.job.status !== JobStatus.ASSIGNED &&
        room.job.status !== JobStatus.PAUSED
      ) {
        throw new ConflictException(
          'Only an active assignment chat can be re-enabled.',
        );
      }
      const saved = await tx.chatRoom.update({
        where: { id: roomId },
        data: {
          status: disabled ? ChatRoomStatus.DISABLED : ChatRoomStatus.ACTIVE,
          disabledAt: disabled ? new Date() : null,
          disabledById: disabled ? adminId : null,
          disabledReason: disabled
            ? reason?.trim() || 'Disabled by administrator.'
            : null,
        },
        include: CHAT_ROOM_INCLUDE,
      });
      await this.audit.log(
        {
          entityType: 'ChatRoom',
          entityId: roomId,
          action: disabled ? 'CHAT_ROOM_DISABLED' : 'CHAT_ROOM_ENABLED',
          actorId: adminId,
          metadata: { reason: reason ?? null },
        },
        tx,
      );
      return saved;
    });
    const response = this.roomResponse(updated, undefined, true);
    this.realtime.publish(roomId, 'chat:room:updated', response);
    return response;
  }

  async archiveRoom(userId: string, roomId: string) {
    const room = await this.findRoom(roomId);
    const member = this.assertMember(room, userId);
    const terminalStatuses: JobStatus[] = [
      JobStatus.COMPLETED,
      JobStatus.CANCELLED,
      JobStatus.FAILED,
    ];
    if (
      !room.assignmentHistory.endedAt &&
      !terminalStatuses.includes(room.job.status)
    ) {
      throw new ConflictException('An active job chat cannot be archived.');
    }
    const archivedAt = new Date();
    await this.prisma.chatRoomMember.update({
      where: { id: member.id },
      data: { archivedAt },
    });
    await this.audit.log({
      entityType: 'ChatRoom',
      entityId: roomId,
      action: 'CHAT_ROOM_ARCHIVED',
      actorId: userId,
    });
    await this.realtime.removeUserFromRoom(userId, roomId);
    return { roomId, archivedAt };
  }

  async confirmCooperation(userId: string, roomId: string) {
    const { room, member } = await this.getCurrentMember(userId, roomId);
    return this.jobs.confirmCooperation(
      userId,
      room.jobId,
      this.side(member.role),
    );
  }

  async denyPartnership(userId: string, roomId: string, reason: string) {
    const { room, member } = await this.getCurrentMember(userId, roomId);
    const result = await this.jobs.denyPartnership(
      userId,
      room.jobId,
      this.side(member.role),
      { reason },
    );
    this.realtime.publish(roomId, 'chat:job:updated', result);
    return result;
  }

  async cancelJob(userId: string, roomId: string, reason: string) {
    const { room, member } = await this.getCurrentMember(userId, roomId);
    const result =
      member.role === UserRole.CUSTOMER
        ? await this.jobs.cancelJob(userId, room.jobId, 'customer', { reason })
        : await this.jobs.dropJob(userId, room.jobId, { reason });
    this.realtime.publish(roomId, 'chat:job:updated', result);
    return result;
  }

  async updateProgress(
    userId: string,
    roomId: string,
    status: JobProgressStatus,
  ) {
    const { room, member } = await this.getCurrentMember(userId, roomId);
    const result = await this.jobs.updateProgress(
      userId,
      room.jobId,
      this.side(member.role),
      { status },
    );
    this.realtime.publish(roomId, 'chat:job:updated', result);
    return result;
  }

  async requestPause(userId: string, roomId: string) {
    const { room, member } = await this.getCurrentMember(userId, roomId);
    const result = await this.jobs.requestPause(
      userId,
      room.jobId,
      this.side(member.role),
    );
    this.realtime.publish(roomId, 'chat:job:updated', result);
    return result;
  }

  async requestResume(userId: string, roomId: string) {
    const { room, member } = await this.getCurrentMember(userId, roomId);
    const result = await this.jobs.requestResume(
      userId,
      room.jobId,
      this.side(member.role),
    );
    this.realtime.publish(roomId, 'chat:job:updated', result);
    return result;
  }

  async authorizeSocketRoom(
    userId: string,
    role: UserRole,
    roomId: string,
    write = false,
  ) {
    const room = await this.findRoom(roomId);
    return write
      ? this.assertCanWrite(room, userId, role)
      : this.assertCanRead(room, userId, role);
  }

  private async getCurrentMember(userId: string, roomId: string) {
    const room = await this.findRoom(roomId);
    const member = this.assertMember(room, userId);
    if (
      room.assignmentHistory.endedAt ||
      room.job.technicianId !== room.assignmentHistory.technicianId
    ) {
      throw new ConflictException(
        'This chat is not for the current job assignment.',
      );
    }
    return { room, member };
  }

  private async findRoom(roomId: string): Promise<ChatRoomDetails> {
    const room = await this.prisma.chatRoom.findUnique({
      where: { id: roomId },
      include: CHAT_ROOM_INCLUDE,
    });
    if (!room) throw new NotFoundException('Chat room not found.');
    return room;
  }

  private async findRoomWith(
    tx: Prisma.TransactionClient,
    roomId: string,
  ): Promise<ChatRoomDetails> {
    const room = await tx.chatRoom.findUnique({
      where: { id: roomId },
      include: CHAT_ROOM_INCLUDE,
    });
    if (!room) throw new NotFoundException('Chat room not found.');
    return room;
  }

  private async lockRoomJob(tx: Prisma.TransactionClient, roomId: string) {
    await tx.$queryRaw`
      SELECT job."id"
      FROM "jobs" job
      JOIN "chat_rooms" room ON room."jobId" = job."id"
      WHERE room."id" = ${roomId}
      FOR UPDATE OF job`;
  }

  private assertMember(room: ChatRoomDetails, userId: string) {
    const member = room.members.find(
      (candidate) => candidate.userId === userId,
    );
    if (!member || member.archivedAt) {
      throw new NotFoundException('Chat room not found.');
    }
    return member;
  }

  private assertCanRead(room: ChatRoomDetails, userId: string, role: UserRole) {
    if (role === UserRole.ADMIN) return null;
    const member = this.assertMember(room, userId);
    if (member.blockedAt) {
      throw new ForbiddenException('You are blocked from this chat room.');
    }
    return member;
  }

  private assertCanWrite(
    room: ChatRoomDetails,
    userId: string,
    role: UserRole,
  ) {
    if (role === UserRole.ADMIN) return null;
    const member = this.assertCanRead(room, userId, role);
    if (room.status !== ChatRoomStatus.ACTIVE) {
      throw new ConflictException('This chat room is disabled.');
    }
    if (
      room.assignmentHistory.endedAt ||
      room.job.technicianId !== room.assignmentHistory.technicianId ||
      (room.job.status !== JobStatus.ASSIGNED &&
        room.job.status !== JobStatus.PAUSED)
    ) {
      throw new ConflictException(
        'This chat is not active for the current job assignment.',
      );
    }
    return member;
  }

  private async messageResponse(
    message: ChatMessageDetails,
    viewerId: string,
    isAdmin = false,
  ) {
    const hidden = message.isTombstone || (message.blockedAt && !isAdmin);
    const downloadUrl =
      !hidden && message.objectKey
        ? await this.storage.getDownloadUrl(
            message.objectKey,
            CHAT_MEDIA_DOWNLOAD_TTL_SECONDS,
          )
        : null;
    return {
      id: message.id,
      roomId: message.roomId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      type: message.type,
      text: hidden ? null : message.text,
      fileName: hidden ? null : message.originalFileName,
      mimeType: hidden ? null : message.mimeType,
      sizeBytes: hidden ? null : message.sizeBytes,
      durationSeconds: hidden ? null : message.durationSeconds,
      downloadUrl,
      downloadPath:
        !hidden && message.objectKey
          ? `/api/v1/chat/rooms/${message.roomId}/messages/${message.id}/media`
          : null,
      isTombstone: message.isTombstone,
      isBlocked: Boolean(message.blockedAt),
      blockReason: isAdmin ? message.blockReason : null,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      createdAt: message.createdAt,
      readBy: message.reads.map((receipt) => ({
        userId: receipt.userId,
        readAt: receipt.readAt,
      })),
      readByOtherSide: message.reads.some(
        (receipt) =>
          receipt.userId !== message.senderId && receipt.userId !== viewerId,
      ),
      readByViewer: message.reads.some(
        (receipt) => receipt.userId === viewerId,
      ),
    };
  }

  private roomResponse(
    room: ChatRoomDetails,
    viewerMember?: {
      id: string;
      userId: string;
      role: UserRole;
      blockedAt: Date | null;
      blockReason: string | null;
      archivedAt: Date | null;
    },
    isAdmin = false,
  ) {
    return {
      id: room.id,
      jobId: room.jobId,
      status: room.status,
      disabledAt: room.disabledAt,
      disabledReason: room.disabledReason,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      job: {
        id: room.job.id,
        status: room.job.status,
        cooperationStatus: room.job.cooperationStatus,
        description: room.job.description,
        service: room.job.serviceCategory?.name ?? room.job.otherServiceName,
        customer: room.job.customer,
        technician: room.assignmentHistory.technician?.user ?? null,
      },
      assignment: {
        id: room.assignmentHistory.id,
        endedAt: room.assignmentHistory.endedAt,
      },
      members: room.members.map((member) => ({
        userId: member.userId,
        role: member.role,
        blockedAt: member.blockedAt,
        ...(isAdmin ? { blockReason: member.blockReason } : {}),
      })),
      currentMember: viewerMember
        ? {
            blockedAt: viewerMember.blockedAt,
            archivedAt: viewerMember.archivedAt,
          }
        : undefined,
    };
  }

  private senderRole(role: UserRole): ChatSenderRole {
    if (role === UserRole.ADMIN) return ChatSenderRole.ADMIN;
    if (role === UserRole.TECHNICIAN) return ChatSenderRole.TECHNICIAN;
    return ChatSenderRole.CUSTOMER;
  }

  private side(role: UserRole): 'customer' | 'technician' {
    return role === UserRole.CUSTOMER ? 'customer' : 'technician';
  }

  private async removeStoredObject(objectKey: string) {
    try {
      await this.storage.delete(objectKey);
    } catch (error) {
      this.logger.error(
        `Could not remove chat attachment ${objectKey}: ${this.errorMessage(error)}`,
      );
      throw error;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
