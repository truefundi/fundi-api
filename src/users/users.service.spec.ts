import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { UsersService } from './users.service';
import { UpdateAccountDto } from './dto/update-account.dto';

// Tests self-service profile reads and updates, including their failure paths.
describe('UsersService profile management', () => {
  const account = {
    id: '9c1f4d2e-7a3b-4c8e-9f10-2b5d6e8a1c34',
    email: 'prince@example.com',
    phoneNumber: '+250788123456',
    fullName: 'Prince Example',
    role: 'CUSTOMER',
    status: 'ACTIVE',
    createdAt: new Date('2026-09-30T10:00:00.000Z'),
    updatedAt: new Date('2026-09-30T10:00:00.000Z'),
  };

  // Builds an isolated service with a mocked Prisma user model.
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(account),
        update: jest.fn().mockResolvedValue(account),
        delete: jest.fn().mockResolvedValue(account),
      },
    };
    return {
      service: new UsersService(prisma as unknown as PrismaService),
      prisma,
    };
  };

  // Returns the caller's own full record, including role and status.
  it('returns the authenticated account profile', async () => {
    const { service, prisma } = createService();
    const result = await service.getById(account.id);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: account.id } });
    expect(result).toMatchObject({
      id: account.id,
      fullName: 'Prince Example',
      email: 'prince@example.com',
      role: 'CUSTOMER',
      status: 'ACTIVE',
    });
  });

  // Fails clearly when the token refers to an account that no longer exists.
  it('returns not found for a deleted account', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.getById(account.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  // Writes every supplied profile field and nothing else.
  it('updates the supplied profile fields', async () => {
    const { service, prisma } = createService();
    await service.updateAccount(account.id, {
      fullName: 'Prince N. Example',
      phoneNumber: '+250788123457',
      email: 'prince.new@example.com',
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: {
        fullName: 'Prince N. Example',
        phoneNumber: '+250788123457',
        email: 'prince.new@example.com',
      },
    });
  });

  // Leaves omitted fields untouched instead of overwriting them with defaults.
  it('leaves omitted fields unchanged', async () => {
    const { service, prisma } = createService();
    await service.updateAccount(account.id, { email: 'prince.new@example.com' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: { email: 'prince.new@example.com' },
    });
  });

  // Stores a cleared email as null, matching the nullable column.
  it('stores an empty email as null', async () => {
    const { service, prisma } = createService();
    await service.updateAccount(account.id, { email: null });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: account.id },
      data: { email: null },
    });
  });

  // Ignores role and status even when a caller smuggles them past validation.
  it('never lets the profile route change role or status', async () => {
    const { service, prisma } = createService();
    await service.updateAccount(account.id, {
      fullName: 'Prince N. Example',
      ...({ role: 'ADMIN', status: 'INACTIVE' } as unknown as UpdateAccountDto),
    });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ fullName: 'Prince N. Example' });
  });

  // Rejects a no-op update so the caller learns nothing was changed.
  it('rejects an empty profile update', async () => {
    const { service, prisma } = createService();
    await expect(service.updateAccount(account.id, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // Confirms the account exists before writing, so updates cannot orphan a session.
  it('rejects an update for an account that no longer exists', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.updateAccount(account.id, { fullName: 'Prince N. Example' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // Converts a uniqueness violation into a conflict the caller can act on.
  it('rejects a phone number or email owned by another account', async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.3.1',
      }),
    );
    await expect(
      service.updateAccount(account.id, { email: 'taken@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Reports a vanished row as not found rather than an unhandled database error.
  it('maps a missing row on update to not found', async () => {
    const { service, prisma } = createService();
    prisma.user.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: '6.3.1',
      }),
    );
    await expect(
      service.updateAccount(account.id, { fullName: 'Prince N. Example' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// Verifies the request validation applied before the profile service runs.
describe('UpdateAccountDto validation', () => {
  // Runs the same transform and validation pipeline as the global ValidationPipe.
  const validate = (body: object) => {
    const instance = plainToInstance(UpdateAccountDto, body);
    return {
      value: instance,
      fields: validateSync(instance as object).map((error) => error.property),
    };
  };

  // Rejects a whitespace-only name, which would otherwise store a blank profile.
  it('rejects a blank full name', () => {
    expect(validate({ fullName: '   ' }).fields).toContain('fullName');
  });

  // Rejects a name that is too short or too long to be a real one.
  it('rejects names outside the allowed length', () => {
    expect(validate({ fullName: 'P' }).fields).toContain('fullName');
    expect(validate({ fullName: 'a'.repeat(121) }).fields).toContain('fullName');
  });

  // Rejects a malformed address while trimming and lowercasing a valid one.
  it('normalizes a valid email and rejects an invalid one', () => {
    const valid = validate({ email: '  Prince@Example.COM  ' });
    expect(valid.fields).not.toContain('email');
    expect(valid.value.email).toBe('prince@example.com');
    expect(validate({ email: 'not-an-email' }).fields).toContain('email');
  });

  // Accepts an empty email as the documented way to clear the stored address.
  it('accepts an empty email as a clear instruction', () => {
    const result = validate({ email: '' });
    expect(result.fields).not.toContain('email');
    expect(result.value.email).toBeNull();
  });

  // Requires the normalized phone format so spacing never creates duplicates.
  it('normalizes the phone number and rejects a malformed one', () => {
    const valid = validate({ phoneNumber: '+250 788-123 (456)' });
    expect(valid.fields).not.toContain('phoneNumber');
    expect(valid.value.phoneNumber).toBe('+250788123456');
    expect(validate({ phoneNumber: 'abc1234' }).fields).toContain('phoneNumber');
  });

  // Leaves every field optional so a caller can send only what changes.
  it('accepts an empty body at the validation layer', () => {
    const result = validate({});
    expect(result.fields).toEqual([]);
    expect(result.value).toEqual({});
  });
});
