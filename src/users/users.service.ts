import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { StaffAccountPolicyService } from '../staff/staff-account-policy.service';
import { StaffAccessEventsService } from '../staff/staff-access-events.service';
import { PermissionsService } from '../staff/permissions.service';
import { isStaffRole, STAFF_ROLES } from '../staff/staff-roles';
import { PrismaService } from '../database/prisma.service';
import {
  JobStatus,
  Prisma,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  ListUsersQueryDto,
  MAX_PAGE_LIMIT,
} from './dto/list-users-query.dto';

// The only user fields any API response may carry. Credential hashes and TOTP
// secrets are deliberately absent: every route here returns the service result
// directly. Listed one field at a time so new user columns are excluded by
// default rather than leaked until someone remembers to strip them.
const USER_RESPONSE_SELECT = {
  id: true,
  email: true,
  phoneNumber: true,
  fullName: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private readonly policy: StaffAccountPolicyService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly events: StaffAccessEventsService,
  ) {}

  // Creates an account using admin-supplied role and status values.
  async create(input: CreateUserDto, actorId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.policy.lock(tx);
        if (isStaffRole(input.role)) {
          await this.permissions.requireSuperAdmin(actorId, tx);
          if (!input.email)
            throw new BadRequestException(
              'Staff accounts require an email address.',
            );
        } else await this.permissions.require(actorId, ['users.manage'], tx);
        const user = await tx.user.create({
          data: {
            fullName: input.fullName.trim(),
            phoneNumber: input.phoneNumber,
            email: input.email || null,
            role: input.role || UserRole.CUSTOMER,
            status: input.status || UserStatus.ACTIVE,
          },
          select: USER_RESPONSE_SELECT,
        });
        await this.audit.log(
          {
            entityType: 'User',
            entityId: user.id,
            actorId,
            action: 'USER_CREATED',
            toStatus: user.role,
          },
          tx,
        );
        return user;
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  // Returns one page of accounts for administrator listing. Role, status, and
  // search filters are applied inside the database query, which also counts the
  // matching rows so pagination metadata stays accurate.
  async findAll(query: ListUsersQueryDto = {}, actorId?: string) {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    this.assertListQueryIsValid(query, page, limit);

    const where: Prisma.UserWhereInput = {
      AND: [this.buildListWhere(query), await this.visibleAccounts(actorId)],
    };
    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: USER_RESPONSE_SELECT,
      }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Matches phone, full-name, and email fragments, retaining all duplicate-name results.
  async search(query: string, actorId?: string) {
    if (!query?.trim())
      throw new BadRequestException('Search query must not be empty.');
    return this.prisma.user.findMany({
      where: {
        AND: [
          { OR: this.buildSearchClauses(query.trim()) },
          await this.visibleAccounts(actorId),
        ],
      },
      orderBy: [{ fullName: 'asc' }, { createdAt: 'desc' }],
      select: USER_RESPONSE_SELECT,
    });
  }

  // Finds a user by ID and returns a clear not-found response when absent.
  async getById(id: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_RESPONSE_SELECT,
    });
    if (!user) throw new NotFoundException(`User with ID ${id} was not found.`);
    if (actorId && isStaffRole(user.role))
      await this.permissions.require(actorId, ['staff.view']);
    return user;
  }

  // Finds a user by unique email and returns a clear not-found response.
  async getByEmail(email: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: USER_RESPONSE_SELECT,
    });
    if (!user)
      throw new NotFoundException(`User with email ${email} was not found.`);
    if (actorId && isStaffRole(user.role))
      await this.permissions.require(actorId, ['staff.view']);
    return user;
  }

  // Updates administrator-managed fields, including role and status.
  async update(id: string, input: UpdateUserDto, actorId?: string) {
    if (
      input.role !== undefined &&
      !Object.values(UserRole).includes(input.role)
    )
      throw new BadRequestException('A valid role is required.');
    if (
      input.status !== undefined &&
      !Object.values(UserStatus).includes(input.status)
    )
      throw new BadRequestException('A valid account status is required.');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const before = await this.policy.authorize(tx, actorId, id, input);
        const user = await tx.user.update({
          where: { id },
          data: {
            ...(input.fullName !== undefined && {
              fullName: input.fullName.trim(),
            }),
            ...(input.phoneNumber !== undefined && {
              phoneNumber: input.phoneNumber,
            }),
            ...(input.email !== undefined && { email: input.email || null }),
            ...(input.role !== undefined && { role: input.role }),
            ...(input.status !== undefined && { status: input.status }),
          },
          select: USER_RESPONSE_SELECT,
        });
        if (
          input.role &&
          isStaffRole(input.role) !== isStaffRole(before.role)
        ) {
          await tx.refreshToken.deleteMany({ where: { userId: id } });
        }
        if (
          input.role &&
          input.role !== before.role &&
          (input.role === UserRole.SUPER_ADMIN ||
            before.role === UserRole.SUPER_ADMIN ||
            !isStaffRole(input.role) ||
            !isStaffRole(before.role))
        ) {
          await tx.staffPermission.deleteMany({ where: { userId: id } });
        }
        await this.audit.log(
          {
            entityType: 'User',
            entityId: id,
            actorId,
            action: 'USER_UPDATED',
            metadata: {
              previousRole: before.role,
              role: user.role,
              previousStatus: before.status,
              status: user.status,
            },
          },
          tx,
        );
        return user;
      });
      this.events.invalidate(id);
      return result;
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  // Updates account-owned fields only, so callers cannot change role or status.
  async updateAccount(id: string, input: UpdateAccountDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.policy.authorize(tx, undefined, id, input);
        return tx.user.update({
          where: { id },
          data: {
            ...(input.fullName !== undefined && {
              fullName: input.fullName.trim(),
            }),
            ...(input.phoneNumber !== undefined && {
              phoneNumber: input.phoneNumber,
            }),
            ...(input.email !== undefined && { email: input.email || null }),
          },
          select: USER_RESPONSE_SELECT,
        });
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async getTechnicianEligibility(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        technicianProfile: {
          select: { verificationStatus: true },
        },
      },
    });
    if (!user) throw new NotFoundException('User account not found.');
    const registered = user.technicianProfile !== null;
    const approved =
      user.technicianProfile?.verificationStatus ===
      VerificationStatus.APPROVED;
    return {
      role: user.role,
      technicianRegistered: registered,
      technicianVerificationStatus:
        user.technicianProfile?.verificationStatus ?? null,
      technicianApproved: approved,
      canSwitchToTechnician: user.role === UserRole.CUSTOMER && approved,
    };
  }

  async switchRole(userId: string, targetRole: UserRole) {
    return this.prisma.$transaction(async (tx) => {
      await this.policy.authorize(tx, undefined, userId, { role: targetRole });
      if (
        ![UserRole.CUSTOMER, UserRole.TECHNICIAN].includes(
          targetRole as 'CUSTOMER' | 'TECHNICIAN',
        )
      ) {
        throw new ForbiddenException(
          'Only customer and technician mode can be selected.',
        );
      }
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!user) throw new NotFoundException('User account not found.');
      if (user.role === targetRole) {
        return { role: user.role, changed: false };
      }

      const profile = await tx.technicianProfile.findUnique({
        where: { userId },
        select: { id: true, verificationStatus: true },
      });
      if (targetRole === UserRole.TECHNICIAN) {
        if (!profile) {
          throw new ConflictException(
            'Register as a technician before switching to technician mode.',
          );
        }
        if (profile.verificationStatus !== VerificationStatus.APPROVED) {
          throw new ConflictException(
            'Your technician profile must be approved by an administrator before switching to technician mode.',
          );
        }
      } else if (profile) {
        await tx.$queryRaw`
          SELECT "id" FROM "technician_profiles"
          WHERE "id" = ${profile.id}
          FOR UPDATE`;
        const activeJobs = await tx.job.count({
          where: {
            technicianId: profile.id,
            status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
          },
        });
        if (activeJobs > 0) {
          throw new ConflictException(
            'You cannot switch to customer mode while you have active technician jobs.',
          );
        }
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: { role: targetRole },
        select: { role: true },
      });
      return { role: updated.role, changed: true };
    });
  }

  // Changes only active/inactive state through the dedicated admin route.
  async updateStatus(id: string, status: UserStatus, actorId?: string) {
    if (!Object.values(UserStatus).includes(status)) {
      throw new BadRequestException(
        `The status must be one of: ${Object.values(UserStatus).join(', ')}.`,
      );
    }
    return this.update(id, { status }, actorId);
  }

  // Deletes a user's account and cascades associated OTP and refresh records.
  async delete(id: string, actorId?: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.policy.authorize(tx, actorId, id, { delete: true });
      await tx.user.delete({ where: { id } });
      await this.audit.log(
        { entityType: 'User', entityId: id, actorId, action: 'USER_DELETED' },
        tx,
      );
    });
    this.events.invalidate(id);
    return { message: 'User deleted successfully.' };
  }

  // Deletes the currently authenticated user's own account.
  async deleteAccount(id: string) {
    return this.delete(id);
  }

  // Validates listing input so invalid values fail with a 400 before any query runs.
  private assertListQueryIsValid(
    query: ListUsersQueryDto,
    page: number,
    limit: number,
  ): void {
    if (!Number.isInteger(page) || page < DEFAULT_PAGE) {
      throw new BadRequestException(
        'The page query parameter must be an integer of 1 or more.',
      );
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
      throw new BadRequestException(
        `The limit query parameter must be an integer between 1 and ${MAX_PAGE_LIMIT}.`,
      );
    }
    if (
      query.role !== undefined &&
      !Object.values(UserRole).includes(query.role)
    ) {
      throw new BadRequestException(
        `The role query parameter must be one of: ${Object.values(UserRole).join(', ')}.`,
      );
    }
    if (
      query.status !== undefined &&
      !Object.values(UserStatus).includes(query.status)
    ) {
      throw new BadRequestException(
        `The status query parameter must be one of: ${Object.values(UserStatus).join(', ')}.`,
      );
    }
    if (
      query.search !== undefined &&
      (typeof query.search !== 'string' || !query.search.trim())
    ) {
      throw new BadRequestException('Search query must not be empty.');
    }
  }

  // Applies the optional role, status, and search filters to one where clause.
  private buildListWhere(query: ListUsersQueryDto): Prisma.UserWhereInput {
    const search = query.search?.trim();
    return {
      ...(query.role !== undefined && { role: query.role }),
      ...(query.status !== undefined && { status: query.status }),
      ...(search !== undefined && { OR: this.buildSearchClauses(search) }),
    };
  }

  private async visibleAccounts(
    actorId?: string,
  ): Promise<Prisma.UserWhereInput> {
    if (
      actorId &&
      (await this.permissions.access(actorId)).permissions.includes(
        'staff.view',
      )
    )
      return {};
    return { role: { notIn: STAFF_ROLES } };
  }

  // Shared substring clauses so listing search and /users/search behave the same.
  private buildSearchClauses(search: string): Prisma.UserWhereInput[] {
    return [
      { fullName: { contains: search, mode: 'insensitive' } },
      { phoneNumber: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Converts database uniqueness violations into actionable API errors.
  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A user with this phone number or email already exists.',
      );
    }
    throw error;
  }
}
