import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { UserRole, UserStatus } from '@prisma/client';
import { UsersService } from './users.service';

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
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([technician]),
        findUnique: jest.fn().mockResolvedValue(admin),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue(admin),
        update: jest.fn().mockResolvedValue(admin),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    const service = new UsersService(prisma as unknown as PrismaService);
    return { service, prisma };
  };

  // Reads the arguments of the single findMany call a test triggered.
  const findManyArgs = (prisma: ReturnType<typeof createService>['prisma']) =>
    prisma.user.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      skip: number;
      take: number;
      orderBy: unknown;
    };

  describe('findAll pagination', () => {
    // Pages are fetched from the database with skip/take, never in memory.
    it('pages through users with database-level skip and take', async () => {
      const { service, prisma } = createService();
      prisma.user.count.mockResolvedValue(45);

      const result = await service.findAll({ page: 3, limit: 10 });

      expect(findManyArgs(prisma)).toMatchObject({ skip: 20, take: 10 });
      expect(prisma.user.count).toHaveBeenCalledWith({ where: {} });
      expect(result.data).toEqual([technician]);
      expect(result.pagination).toEqual({ page: 3, limit: 10, total: 45, totalPages: 5 });
    });

    // Callers that send no parameters still get the documented defaults.
    it('defaults to page 1 with 20 users per page', async () => {
      const { service, prisma } = createService();

      const result = await service.findAll();

      expect(findManyArgs(prisma)).toMatchObject({ skip: 0, take: 20 });
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    // Total pages are derived from the counted total, not the page's rows.
    it('calculates pagination metadata from the matching total', async () => {
      const { service, prisma } = createService();
      prisma.user.count.mockResolvedValue(100);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 100, totalPages: 5 });
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

      expect(prisma.user.count).toHaveBeenCalledWith({ where: { role: 'TECHNICIAN' } });
      expect(findManyArgs(prisma).where).toEqual({ role: 'TECHNICIAN' });
    });

    // Account-status filtering reuses the existing status field.
    it('filters by status', async () => {
      const { service, prisma } = createService();

      await service.findAll({ status: 'INACTIVE' });

      expect(prisma.user.count).toHaveBeenCalledWith({ where: { status: 'INACTIVE' } });
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
      expect(prisma.user.count).toHaveBeenCalledWith({ where: args.where });
      expect(result.pagination).toEqual({ page: 2, limit: 5, total: 2, totalPages: 1 });
    });

    // The pre-existing /users/search route shares the same clauses, now including email.
    it('keeps the dedicated search route matching name, phone, and email', async () => {
      const { service, prisma } = createService();

      await service.search(' john ');

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { fullName: { contains: 'john', mode: 'insensitive' } },
            { phoneNumber: { contains: 'john' } },
            { email: { contains: 'john', mode: 'insensitive' } },
          ],
        },
        orderBy: [{ fullName: 'asc' }, { createdAt: 'desc' }],
      });
    });

    // An empty query keeps failing loudly on the dedicated route.
    it('rejects an empty search query on the dedicated route', async () => {
      const { service, prisma } = createService();

      await expect(service.search('   ')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('returns the user for a known id', async () => {
      const { service, prisma } = createService();

      const result = await service.getById(adminId);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: adminId } });
      expect(result).toEqual(admin);
    });

    it('throws NotFound when the user does not exist', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getById(adminId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('activates a user', async () => {
      const { service, prisma } = createService();
      prisma.user.update.mockResolvedValue({ ...admin, status: 'ACTIVE' });

      const result = await service.updateStatus(adminId, 'ACTIVE');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: adminId } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: adminId },
        data: { status: 'ACTIVE' },
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
      });
      expect(result.status).toBe('INACTIVE');
    });

    it('throws NotFound when the user does not exist', async () => {
      const { service, prisma } = createService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.updateStatus(adminId, 'INACTIVE')).rejects.toBeInstanceOf(
        NotFoundException,
      );
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

      await expect(service.findAll({ page: 0 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.findAll({ page: 1.5 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.findAll({ limit: 0 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.findAll({ limit: 101 })).rejects.toBeInstanceOf(BadRequestException);
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

      await expect(service.findAll({ search: '' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.findAll({ search: '   ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });
});
