import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_LIMIT,
  ListUsersQueryDto,
  MAX_PAGE_LIMIT,
} from './dto/list-users-query.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // Creates an account using admin-supplied role and status values.
  async create(input: CreateUserDto) {
    try {
      return await this.prisma.user.create({
        data: {
          fullName: input.fullName.trim(),
          phoneNumber: input.phoneNumber,
          email: input.email || null,
          role: input.role || UserRole.CUSTOMER,
          status: input.status || UserStatus.ACTIVE,
        },
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  // Returns one page of accounts for administrator listing. Role, status, and
  // search filters are applied inside the database query, which also counts the
  // matching rows so pagination metadata stays accurate.
  async findAll(query: ListUsersQueryDto = {}) {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    this.assertListQueryIsValid(query, page, limit);

    const where = this.buildListWhere(query);
    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
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
  async search(query: string) {
    if (!query?.trim()) throw new BadRequestException('Search query must not be empty.');
    return this.prisma.user.findMany({
      where: { OR: this.buildSearchClauses(query.trim()) },
      orderBy: [{ fullName: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // Finds a user by ID and returns a clear not-found response when absent.
  async getById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException(`User with ID ${id} was not found.`);
    return user;
  }

  // Finds a user by unique email and returns a clear not-found response.
  async getByEmail(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException(`User with email ${email} was not found.`);
    return user;
  }

  // Updates administrator-managed fields, including role and status.
  async update(id: string, input: UpdateUserDto) {
    await this.getById(id);
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(input.fullName !== undefined && { fullName: input.fullName.trim() }),
          ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber }),
          ...(input.email !== undefined && { email: input.email || null }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.status !== undefined && { status: input.status }),
        },
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  // Updates account-owned fields only, so callers cannot change role or status.
  async updateAccount(id: string, input: UpdateAccountDto) {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(input.fullName !== undefined && { fullName: input.fullName.trim() }),
          ...(input.phoneNumber !== undefined && { phoneNumber: input.phoneNumber }),
          ...(input.email !== undefined && { email: input.email || null }),
        },
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  // Changes only active/inactive state through the dedicated admin route.
  async updateStatus(id: string, status: UserStatus) {
    if (!Object.values(UserStatus).includes(status)) {
      throw new BadRequestException(
        `The status must be one of: ${Object.values(UserStatus).join(', ')}.`,
      );
    }
    await this.getById(id);
    return this.prisma.user.update({ where: { id }, data: { status } });
  }

  // Deletes a user's account and cascades associated OTP and refresh records.
  async delete(id: string) {
    await this.getById(id);
    await this.prisma.user.delete({ where: { id } });
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
    if (query.role !== undefined && !Object.values(UserRole).includes(query.role)) {
      throw new BadRequestException(
        `The role query parameter must be one of: ${Object.values(UserRole).join(', ')}.`,
      );
    }
    if (query.status !== undefined && !Object.values(UserStatus).includes(query.status)) {
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A user with this phone number or email already exists.');
    }
    throw error;
  }
}
