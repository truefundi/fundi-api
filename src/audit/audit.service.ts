import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actorId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface ListAuditLogsParams {
  entityType?: string;
  entityId?: string;
  action?: string;
  actorId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pass `tx` when logging inside a $transaction so the state change and its
   * audit row commit (or roll back) together.
   */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({ data: entry });
  }

  async list(params: ListAuditLogsParams) {
    const where: Prisma.AuditLogWhereInput = {};

    if (params.entityType) where.entityType = params.entityType;
    if (params.entityId) where.entityId = params.entityId;
    if (params.action) where.action = params.action;
    if (params.actorId) where.actorId = params.actorId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = params.from;
      if (params.to) where.createdAt.lte = params.to;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: params.limit,
        skip: params.offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      limit: params.limit,
      offset: params.offset,
    };
  }

  async get(id: string) {
    const log = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!log) {
      throw new NotFoundException('Audit log not found.');
    }
    return log;
  }
}
