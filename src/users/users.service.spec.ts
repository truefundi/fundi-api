import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  JobStatus,
  UserRole,
  UserStatus,
  VerificationStatus,
} from '@prisma/client';
import { UsersService } from './users.service';
import { STAFF_ROLES } from '../staff/staff-roles';

// Tests admin listing (paging, filters, search) and status management rules.
describe('UsersService', () => {
  const adminId = '0a1b2c3d-0000-4000-8000-000000000001';
  const admin = {
    id: adminId,
    email: 'alice@example.com',
    phoneNumber: '+250788000001',
    fullName: 'Alice Admin',
    role: 'ADMIN',
    status: 'ACTIVE',
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
  };
  const technician = {
    id: '0a1b2c3d-0000-4000-8000-000000000002',
    email: 'john@example.com',
    phoneNumber: '+250788000002',
    fullName: 'John Technician',
    role: 'TECHNICIAN',
    status: 'ACTIVE',
    createdAt: new Date('2026-10-01T11:00:00.000Z'),
    updatedAt: new Date('2026-10-01T11:00:00.000Z'),
  };

  // Builds a Prisma double exposing only the user methods the service touches.
  const createService = () => {
    const transaction = {
      user: {
        create: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: technician.id,
          role: UserRole.CUSTOMER,
        }),
        update: jest.fn(({ data }: { data: { role: UserRole } }) =>
          Promise.resolve({ role: data.role }),
        ),
      },
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      job: {
        count: jest.fn().mockResolvedValue(0),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([technician]),
        findUnique: jest.fn().mockResolvedValue(admin),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(admin),
        update: jest.fn().mockResolvedValue(admin),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      job: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(
        (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    transaction.user.create = prisma.user.create;
    transaction.user.delete = prisma.user.delete;
    // Preserve the exact update arguments for response-selection assertions.
    transaction.user.update.mockImplementation((args) =>
      args.data.role
        ? Promise.resolve({ role: args.data.role })
        : (prisma.user.update as jest.Mock)(args),
    );
    const policy = {
      lock: jest.fn(),
      authorize: jest.fn(async (_tx, _actor, id) => {
        const user = await (prisma.user.findUnique as jest.Mock)({
          where: { id },
          select: safeSelect,
        });
        if (!user) throw new NotFoundException();
        return user;
      }),
    };
    const service = new UsersService(
      prisma as unknown as PrismaService,
      policy as never,
      {
        require: jest.fn(),
        requireSuperAdmin: jest.fn(),
        access: jest.fn().mockResolvedValue({ permissions: [] }),
      } as never,
      { log: jest.fn() } as never,
      { invalidate: jest.fn() } as never,
    );
    return { service, prisma, transaction };
  };

  // Mirrors of the fields UserResponseDto documents. The service must select
  // exactly these and never passwordHash or totpSecret, because every route
  // returns its result straight to the caller.
  const safeSelect = {
    id: true,
    email: true,
    phoneNumber: true,
    fullName: true,
    role: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  };

  // Reads the arguments of the single findMany call a test triggered.
  const findManyArgs = (prisma: ReturnType<typeof createService>['prisma']) => {
    const args = (prisma.user.findMany as jest.Mock).mock.calls[0][0];
    return { ...args, where: args.where.AND[0] };
  };

  describe('findAll pagination', () => {
    // Pages are fetched from the database with skip/take, never in memory.
    it('pages through users with database-level skip and take', async () => {
      const { service, prisma } = createService();
      prisma.user.count.mockResolvedValue(45);

      const result = await service.findAll({ page: 3, limit: 10 });

      expect(findManyArgs(prisma)).toMatchObject({ skip: 20, take: 10 });
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { AND: [{}, { role: { notIn: STAFF_ROLES } }] },
      });
      expect(result.data).toEqual([technician]);
      expect(result.pagination).toEqual({
        page: 3,
        limit: 10,
        total: 45,
        totalPages: 5,
      });
    });

    describe('technician eligibility and role switching', () => {
      it('reports an unapproved application as ineligible to switch', async () => {
        const { service, prisma } = createService();
        prisma.user.findUnique.mockResolvedValue({
          role: UserRole.CUSTOMER,
          technicianProfile: {
            verificationStatus: VerificationStatus.PENDING,
          },
        } as never);

        await expect(
          service.getTechnicianEligibility(technician.id),
        ).resolves.toMatchObject({
          technicianRegistered: true,
          technicianApproved: false,
          canSwitchToTechnician: false,
        });
      });

      it('allows switching to technician only for an approved profile', async () => {
        const { service, transaction } = createService();
        transaction.technicianProfile.findUnique.mockResolvedValue({
          id: 'profile-1',
          verificationStatus: VerificationStatus.APPROVED,
        });

        await expect(
          service.switchRole(technician.id, UserRole.TECHNICIAN),
        ).resolves.toEqual({ role: UserRole.TECHNICIAN, changed: true });
        expect(transaction.user.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: { role: UserRole.TECHNICIAN },
          }),
        );
      });

      it('requires customer accounts to register and receive technician approval first', async () => {
        const { service, transaction } = createService();
        await expect(
          service.switchRole(technician.id, UserRole.TECHNICIAN),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(transaction.user.update).not.toHaveBeenCalled();
      });

      it('blocks switching to customer while assigned technician jobs remain active', async () => {
        const { service, transaction } = createService();
        transaction.user.findUnique.mockResolvedValue({
          id: technician.id,
          role: UserRole.TECHNICIAN,
        });
        transaction.technicianProfile.findUnique.mockResolvedValue({
          id: 'profile-1',
          verificationStatus: VerificationStatus.APPROVED,
        });
        transaction.job.count.mockResolvedValue(1);

        await expect(
          service.switchRole(technician.id, UserRole.CUSTOMER),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(transaction.job.count).toHaveBeenCalledWith({
          where: {
            technicianId: 'profile-1',
            status: { in: [JobStatus.ASSIGNED, JobStatus.PAUSED] },
          },
        });
        expect(transaction.user.update).not.toHaveBeenCalled();
      });

      it('switches an idle technician back to customer mode', async () => {
        const { service, transaction } = createService();
        transaction.user.findUnique.mockResolvedValue({
          id: technician.id,
          role: UserRole.TECHNICIAN,
        });
        transaction.technicianProfile.findUnique.mockResolvedValue({
          id: 'profile-1',
          verificationStatus: VerificationStatus.APPROVED,
        });

        await expect(
          service.switchRole(technician.id, UserRole.CUSTOMER),
        ).resolves.toEqual({ role: UserRole.CUSTOMER, changed: true });
      });
    });

    // Callers that send no parameters still get the documented defaults.
    it('defaults to page 1 with 20 users per page', async () => {
      const { service, prisma } = createService();

      const result = await service.findAll();

      expect(findManyArgs(prisma)).toMatchObject({ skip: 0, take: 20 });
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    // Total pages are derived from the counted total, not the page's rows.
    it('calculates pagination metadata from the matching total', async () => {
      const { service, prisma } = createService();
      prisma.user.count.mockResolvedValue(100);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 100,
        totalPages: 5,
      });
    });

    // An empty result set reports zero rows and zero pages.
    it('returns an empty page when nothing matches', async () => {
      const { service, prisma } = createService();
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual({
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });
  });

  describe('findAll filters', () => {
    // Role filtering happens inside the shared where clause.
    it('filters by role', async () => {
      const { service, prisma } = createService();

      await service.findAll({ role: 'TECHNICIAN' });

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: {
          AND: [{ role: 'TECHNICIAN' }, { role: { notIn: STAFF_ROLES } }],
        },
      });
      expect(findManyArgs(prisma).where).toEqual({ role: 'TECHNICIAN' });
    });

    // Account-status filtering reuses the existing status field.
    it('filters by status', async () => {
      const { service, prisma } = createService();

      await service.findAll({ status: 'INACTIVE' });

      expect(prisma.user.count).toHaveBeenCalledWith({
        where: {
          AND: [{ status: 'INACTIVE' }, { role: { notIn: STAFF_ROLES } }],
        },
      });
      expect(findManyArgs(prisma).where).toEqual({ status: 'INACTIVE' });
    });
  });

  describe('findAll search', () => {
    // Full-name matching is case-insensitive.
    it('searches by full name', async () => {
      const { service, prisma } = createService();

      await service.findAll({ search: 'John' });

      expect(findManyArgs(prisma).where.OR).toContainEqual({
        fullName: { contains: 'John', mode: 'insensitive' },
      });
    });

    // Phone fragments match the stored number.
    it('searches by phone number', async () => {
      const { service, prisma } = createService();

      await service.findAll({ search: '+250788' });

      expect(findManyArgs(prisma).where.OR).toContainEqual({
        phoneNumber: { contains: '+250788' },
      });
    });

    // Email matching is case-insensitive as well.
    it('searches by email', async () => {
      const { service, prisma } = createService();

      await service.findAll({ search: 'EXAMPLE.com' });

      expect(findManyArgs(prisma).where.OR).toContainEqual({
        email: { contains: 'EXAMPLE.com', mode: 'insensitive' },
      });
    });

    // Search, filters, and paging all land in the same database query.
    it('combines search, filters, and pagination', async () => {
      const { service, prisma } = createService();
      prisma.user.count.mockResolvedValue(2);

      const result = await service.findAll({
        search: ' john ',
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        page: 2,
        limit: 5,
      });

      const args = findManyArgs(prisma);
      expect(args.where).toEqual({
        role: 'TECHNICIAN',
        status: 'ACTIVE',
        OR: [
          { fullName: { contains: 'john', mode: 'insensitive' } },
          { phoneNumber: { contains: 'john' } },
          { email: { contains: 'john', mode: 'insensitive' } },
        ],
      });
      expect(args.skip).toBe(5);
      expect(args.take).toBe(5);
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { AND: [args.where, { role: { notIn: STAFF_ROLES } }] },
      });
      expect(result.pagination).toEqual({
        page: 2,
        limit: 5,
        total: 2,
        totalPages: 1,
      });
    });

    // The pre-existing /users/search route shares the same clauses, now including email.
    it('keeps the dedicated search route matching name, phone, and email', async () => {
      const { service, prisma } = createService();

      await service.search(' john ');

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          AND: [
            {
              OR: [
                { fullName: { contains: 'john', mode: 'insensitive' } },
                { phoneNumber: { contains: 'john' } },
                { email: { contains: 'john', mode: 'insensitive' } },
              ],
            },
            { role: { notIn: STAFF_ROLES } },
          ],
        },
        orderBy: [{ fullName: 'asc' }, { createdAt: 'desc' }],
        select: safeSelect,
      });
    });

    // An empty query keeps failing loudly on the dedicated route.
    it('rejects an empty search query on the dedicated route', async () => {
      const { service, prisma } = createService();

      await expect(service.search('   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns the user for a known id', async () => {
      const { service, prisma } = createService();

      const result = await service.getById(adminId);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: adminId },
        select: safeSelect,
      });
      expect(result).toEqual(admin);
    });

    it('throws NotFound when the user does not exist', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getById(adminId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('activates a user', async () => {
      const { service, prisma } = createService();
      prisma.user.update.mockResolvedValue({ ...admin, status: 'ACTIVE' });

      const result = await service.updateStatus(adminId, 'ACTIVE');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: adminId },
        select: safeSelect,
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: adminId },
        data: { status: 'ACTIVE' },
        select: safeSelect,
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('deactivates a user', async () => {
      const { service, prisma } = createService();
      prisma.user.update.mockResolvedValue({ ...admin, status: 'INACTIVE' });

      const result = await service.updateStatus(adminId, 'INACTIVE');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: adminId },
        data: { status: 'INACTIVE' },
        select: safeSelect,
      });
      expect(result.status).toBe('INACTIVE');
    });

    it('throws NotFound when the user does not exist', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus(adminId, 'INACTIVE'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown status value before touching the database', async () => {
      const { service, prisma } = createService();

      await expect(
        service.updateStatus(adminId, 'PENDING' as UserStatus),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll invalid parameters', () => {
    it('rejects invalid page and limit values', async () => {
      const { service, prisma } = createService();

      await expect(service.findAll({ page: 0 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.findAll({ page: 1.5 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.findAll({ limit: 0 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.findAll({ limit: 101 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('rejects unknown role and status filter values', async () => {
      const { service, prisma } = createService();

      await expect(
        service.findAll({ role: 'SUPERADMIN' as UserRole }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.findAll({ status: 'PENDING' as UserStatus }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('rejects an empty search value', async () => {
      const { service, prisma } = createService();

      await expect(service.findAll({ search: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.findAll({ search: '   ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('response field selection', () => {
    // Every route returns the service result directly, so each Prisma call must
    // ask for the response-safe fields only. A regression here reopens the leak
    // where GET /auth/me handed back the bcrypt hash and the TOTP secret.
    it.each([
      [
        'create',
        (service: UsersService) =>
          service.create(
            { phoneNumber: '+250788000001', fullName: 'New User' },
            adminId,
          ),
        'create',
      ],
      ['findAll', (service: UsersService) => service.findAll(), 'findMany'],
      [
        'search',
        (service: UsersService) => service.search('alice'),
        'findMany',
      ],
      [
        'getById',
        (service: UsersService) => service.getById(adminId),
        'findUnique',
      ],
      [
        'getByEmail',
        (service: UsersService) => service.getByEmail('alice@example.com'),
        'findUnique',
      ],
      [
        'update',
        (service: UsersService) =>
          service.update(adminId, { fullName: 'Renamed' }),
        'update',
      ],
      [
        'updateAccount',
        (service: UsersService) =>
          service.updateAccount(adminId, { fullName: 'Renamed' }),
        'update',
      ],
      [
        'updateStatus',
        (service: UsersService) => service.updateStatus(adminId, 'INACTIVE'),
        'update',
      ],
    ])(
      '%s selects only response-safe fields',
      async (name, run, prismaMethod) => {
        const { service, prisma } = createService();

        await run(service);

        const call = (prisma.user as Record<string, jest.Mock>)[prismaMethod]
          .mock.calls[0][0];
        expect(call.select).toEqual(safeSelect);
      },
    );

    // The three columns the select exists to keep out, stated explicitly so the
    // intent survives even if someone reshapes the select above.
    it('never requests credential hashes or TOTP secrets', async () => {
      const { service, prisma } = createService();

      await service.create(
        { phoneNumber: '+250788000001', fullName: 'New User' },
        adminId,
      );
      await service.findAll();
      await service.search('alice');
      await service.getById(adminId);
      await service.getByEmail('alice@example.com');
      await service.update(adminId, { fullName: 'Renamed' });
      await service.updateAccount(adminId, { fullName: 'Renamed' });
      await service.updateStatus(adminId, 'INACTIVE');

      const allCalls = [
        ...prisma.user.create.mock.calls,
        ...prisma.user.findMany.mock.calls,
        ...prisma.user.findUnique.mock.calls,
        ...prisma.user.update.mock.calls,
      ];
      expect(allCalls.length).toBeGreaterThan(0);
      for (const [args] of allCalls) {
        const selected = Object.keys(args?.select ?? {});
        expect(selected).not.toContain('passwordHash');
        expect(selected).not.toContain('pinHash');
        expect(selected).not.toContain('totpSecret');
        expect(selected).not.toContain('totpEnabledAt');
      }
    });
  });
});
