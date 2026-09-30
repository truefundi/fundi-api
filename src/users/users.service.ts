import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

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

  // Returns all accounts for administrator listing.
  async findAll() {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  }

  // Matches phone and full-name fragments, retaining all duplicate-name results.
  async search(query: string) {
    if (!query?.trim()) throw new BadRequestException('Search query must not be empty.');
    return this.prisma.user.findMany({
      where: {
        OR: [
          { phoneNumber: { contains: query.trim() } },
          { fullName: { contains: query.trim(), mode: 'insensitive' } },
        ],
      },
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

  // Converts database uniqueness violations into actionable API errors.
  private handleWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A user with this phone number or email already exists.');
    }
    throw error;
  }
}
