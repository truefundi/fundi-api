import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { isStaffRole, STAFF_ROLES } from './staff-roles';
import { PermissionKey, PERMISSION_KEYS } from './permission-catalog';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async access(userId: string, client: Prisma.TransactionClient = this.prisma) {
    const user = await client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
        staffPermissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!user || !isStaffRole(user.role) || user.status !== 'ACTIVE') {
      throw new ForbiddenException('An active staff account is required.');
    }
    const superAdmin = user.role === UserRole.SUPER_ADMIN;
    return {
      userId: user.id,
      role: user.role,
      superAdmin,
      permissions: superAdmin
        ? [...PERMISSION_KEYS]
        : user.staffPermissions
            .map((assignment) => assignment.permission.key)
            .filter(
              (key): key is PermissionKey =>
                key !== 'staff.manage' &&
                PERMISSION_KEYS.includes(key as PermissionKey),
            ),
    };
  }

  async require(
    userId: string,
    required: readonly PermissionKey[],
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const access = await this.access(userId, client);
    const missing = required.filter((key) => !access.permissions.includes(key));
    if (missing.length)
      throw new ForbiddenException({
        message: 'Required staff permissions are missing.',
        requiredPermissions: missing,
      });
    return access;
  }

  async requireSuperAdmin(
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    const access = await this.access(userId, client);
    if (!access.superAdmin)
      throw new ForbiddenException(
        'Only SUPER_ADMIN can manage staff privileges.',
      );
    return access;
  }

  /** Query-time filtering for staff notifications. Ordinary role labels never grant access. */
  recipientsWhere(required: readonly PermissionKey[]): Prisma.UserWhereInput {
    return {
      status: 'ACTIVE',
      OR: [
        { role: UserRole.SUPER_ADMIN },
        {
          role: {
            in: required.includes('staff.manage')
              ? []
              : STAFF_ROLES.filter((role) => role !== UserRole.SUPER_ADMIN),
          },
          AND: required.map((key) => ({
            staffPermissions: { some: { permission: { key } } },
          })),
        },
      ],
    };
  }
}
