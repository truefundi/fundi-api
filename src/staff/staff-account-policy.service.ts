import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { PermissionsService } from './permissions.service';
import { isStaffRole } from './staff-roles';

@Injectable()
export class StaffAccountPolicyService {
  constructor(private readonly permissions: PermissionsService) {}

  // Also serializes concurrent changes by different super admins, protecting the
  // last active super admin and preventing a demoted caller from granting access.
  async lock(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(734321)::text`;
  }

  async authorize(
    tx: Prisma.TransactionClient,
    actorId: string | undefined,
    id: string,
    change: {
      role?: UserRole;
      status?: UserStatus;
      delete?: boolean;
      email?: string | null;
    },
  ) {
    await this.lock(tx);
    const target = await tx.user.findUnique({
      where: { id },
      select: { id: true, role: true, status: true, email: true },
    });
    if (!target) throw new NotFoundException('User account not found.');
    if (isStaffRole(target.role) || isStaffRole(change.role)) {
      if (!actorId)
        throw new ForbiddenException(
          'Staff accounts must be managed through the staff portal.',
        );
      await this.permissions.requireSuperAdmin(actorId, tx);
      if (target.role === UserRole.SUPER_ADMIN) {
        const removesAccess =
          change.delete ||
          (change.role !== undefined && change.role !== UserRole.SUPER_ADMIN) ||
          (change.status !== undefined && change.status !== UserStatus.ACTIVE);
        if (removesAccess && actorId === id)
          throw new ConflictException(
            'You cannot remove your own SUPER_ADMIN access.',
          );
        if (removesAccess && target.status === UserStatus.ACTIVE) {
          const count = await tx.user.count({
            where: { role: UserRole.SUPER_ADMIN, status: UserStatus.ACTIVE },
          });
          if (count <= 1)
            throw new ConflictException(
              'The last active SUPER_ADMIN must be retained.',
            );
        }
      }
      if (
        !change.delete &&
        isStaffRole(change.role ?? target.role) &&
        !(change.email === undefined ? target.email : change.email)
      ) {
        throw new ConflictException(
          'Staff accounts require an email address for dashboard sign-in.',
        );
      }
    } else if (actorId) {
      await this.permissions.require(actorId, ['users.manage'], tx);
    }
    return target;
  }
}
