import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ListStaffDto, UpdateStaffPermissionsDto } from './dto/staff.dto';
import { PERMISSION_KEYS } from './permission-catalog';
import { PermissionsService } from './permissions.service';
import { StaffAccountPolicyService } from './staff-account-policy.service';
import { StaffAccessEventsService } from './staff-access-events.service';
import { isStaffRole, STAFF_ROLES } from './staff-roles';

const STAFF_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phoneNumber: true,
  role: true,
  status: true,
  staffPermissions: { select: { permission: { select: { key: true } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly policy: StaffAccountPolicyService,
    private readonly audit: AuditService,
    private readonly events: StaffAccessEventsService,
  ) {}

  async catalog() {
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: PERMISSION_KEYS } },
      orderBy: [{ module: 'asc' }, { sortOrder: 'asc' }, { key: 'asc' }],
    });
    return [...new Set(permissions.map((p) => p.module))].map((module) => ({
      module,
      permissions: permissions
        .filter((p) => p.module === module)
        .map((p) => ({ ...p, reserved: p.key === 'staff.manage' })),
    }));
  }

  async list(query: ListStaffDto) {
    const where: Prisma.UserWhereInput = {
      role: query.role ?? { in: STAFF_ROLES },
      ...(query.search?.trim()
        ? {
            OR: ['fullName', 'email', 'phoneNumber'].map((field) => ({
              [field]: { contains: query.search!.trim(), mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: STAFF_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return {
      data: users.map((user) => this.summary(user)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getAccess(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: STAFF_SELECT,
    });
    if (!user || !isStaffRole(user.role))
      throw new NotFoundException('Staff member not found.');
    const summary = this.summary(user);
    return {
      ...summary,
      modules: (await this.catalog()).map((group) => ({
        ...group,
        permissions: group.permissions.map((p) => ({
          ...p,
          enabled:
            summary.superAdmin || summary.assignedPermissions.includes(p.key),
          locked: summary.superAdmin || p.reserved,
        })),
      })),
    };
  }

  async updatePermissions(
    actorId: string,
    id: string,
    dto: UpdateStaffPermissionsDto,
  ) {
    const keys = dto.permissions.map((p) => p.key);
    if (
      !keys.length ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !PERMISSION_KEYS.includes(key))
    ) {
      throw new BadRequestException('Provide distinct, known permission keys.');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.policy.lock(tx);
      await this.permissions.requireSuperAdmin(actorId, tx);
      const target = await tx.user.findUnique({
        where: { id },
        select: STAFF_SELECT,
      });
      if (!target || !isStaffRole(target.role))
        throw new NotFoundException('Staff member not found.');
      if (target.role === UserRole.SUPER_ADMIN)
        throw new ConflictException(
          'SUPER_ADMIN permissions are always enabled and cannot be edited.',
        );
      if (keys.includes('staff.manage'))
        throw new BadRequestException(
          'staff.manage is reserved for SUPER_ADMIN.',
        );
      const definitions = await tx.permission.findMany({
        where: { key: { in: keys } },
      });
      if (definitions.length !== keys.length)
        throw new ConflictException(
          'Permission catalog is incomplete. Apply the database migrations.',
        );
      const before = this.summary(target).assignedPermissions;
      for (const toggle of dto.permissions) {
        const permission = definitions.find((p) => p.key === toggle.key)!;
        if (toggle.enabled) {
          await tx.staffPermission.upsert({
            where: {
              userId_permissionId: { userId: id, permissionId: permission.id },
            },
            create: {
              userId: id,
              permissionId: permission.id,
              grantedById: actorId,
            },
            update: {},
          });
        } else {
          await tx.staffPermission.deleteMany({
            where: { userId: id, permissionId: permission.id },
          });
        }
      }
      await this.audit.log(
        {
          entityType: 'User',
          entityId: id,
          action: 'STAFF_PERMISSIONS_UPDATED',
          actorId,
          metadata: {
            previousPermissions: before,
            changes: dto.permissions.map((toggle) => ({ ...toggle })),
          },
        },
        tx,
      );
    });
    this.events.invalidate(id);
    return this.getAccess(id);
  }

  async updateRole(actorId: string, id: string, role: UserRole) {
    if (!isStaffRole(role))
      throw new BadRequestException('A staff role is required.');
    await this.prisma.$transaction(async (tx) => {
      const target = await this.policy.authorize(tx, actorId, id, { role });
      if (!isStaffRole(target.role))
        throw new NotFoundException('Staff member not found.');
      await tx.user.update({
        where: { id },
        data: { role },
        select: { id: true },
      });
      if (
        role === UserRole.SUPER_ADMIN ||
        target.role === UserRole.SUPER_ADMIN
      ) {
        await tx.staffPermission.deleteMany({ where: { userId: id } });
      }
      await this.audit.log(
        {
          entityType: 'User',
          entityId: id,
          action: 'STAFF_ROLE_UPDATED',
          actorId,
          fromStatus: target.role,
          toStatus: role,
        },
        tx,
      );
    });
    this.events.invalidate(id);
    return this.getAccess(id);
  }

  private summary(
    user: Prisma.UserGetPayload<{ select: typeof STAFF_SELECT }>,
  ) {
    const { staffPermissions, ...identity } = user;
    const superAdmin = user.role === UserRole.SUPER_ADMIN;
    const assignedPermissions = staffPermissions
      .map((a) => a.permission.key)
      .filter(
        (key) =>
          key !== 'staff.manage' && (PERMISSION_KEYS as string[]).includes(key),
      )
      .sort();
    return {
      ...identity,
      superAdmin,
      assignedPermissions,
      effectivePermissions:
        user.status !== 'ACTIVE'
          ? []
          : superAdmin
            ? [...PERMISSION_KEYS]
            : assignedPermissions,
    };
  }
}
