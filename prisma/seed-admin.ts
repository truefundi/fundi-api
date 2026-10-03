import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { hash } from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminLoginDto } from '../src/auth/dto/admin-login.dto';

const prisma = new PrismaClient();

// Matches the adminAuth.bcryptRounds default in src/config/configuration.ts.
const DEFAULT_ROUNDS = 12;

// Reads a variable that has no sensible fallback, so an incomplete environment fails
// loudly instead of provisioning a half-configured administrator.
function required(name: string, hint: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. ${hint}`);
  }
  return value;
}

// Checks the credentials with the same DTO the login endpoint validates against,
// rather than restating the rules. If the two ever drift apart this script could
// provision an administrator whose password the API then refuses, locking them out of
// an account nobody else can reach.
async function assertSignInRules(email: string, password: string) {
  const dto = plainToInstance(AdminLoginDto, { email, password });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new Error(
      `The password cannot be used to sign in:\n  - ${messages.join('\n  - ')}\n` +
        'Fix it and run this again. There is no password reset route yet, so an admin ' +
        'created with a rejected password could only be repaired from the database.',
    );
  }
}

// Turns Prisma's unique-constraint failure into something an operator can act on,
// since both email and phone number are unique and are the likely collisions.
function explainConflict(error: unknown): string {
  const target = (error as { meta?: { target?: string[] } })?.meta?.target;
  const fields = Array.isArray(target) ? target.join(', ') : 'a unique field';
  return (
    `Another user already uses ${fields}. ` +
    'Choose a different phone number, or clear it on the existing account first.'
  );
}

async function main() {
  const email = required('ADMIN_EMAIL', 'Example: ADMIN_EMAIL=admin@fundi.rw').toLowerCase();
  const fullName = required('ADMIN_FULL_NAME', 'Example: ADMIN_FULL_NAME="Alice Mukamana"');
  const phoneNumber = required(
    'ADMIN_PHONE_NUMBER',
    'The number the second-factor code is sent to. Example: ADMIN_PHONE_NUMBER=+250788123456',
  );
  // Read but deliberately not trimmed: leading and trailing spaces are part of a
  // password, and silently removing them would lock the operator out of their own
  // account. Read from the environment rather than a command-line argument so the
  // password does not end up in shell history or in the process list.
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!password) {
    throw new Error('ADMIN_PASSWORD is not set.');
  }

  const parsedRounds = Number.parseInt(process.env.ADMIN_BCRYPT_ROUNDS ?? '', 10);
  const rounds = Number.isNaN(parsedRounds) ? DEFAULT_ROUNDS : parsedRounds;
  if (rounds < 4 || rounds > 15) {
    throw new Error('ADMIN_BCRYPT_ROUNDS must be between 4 and 15.');
  }

  await assertSignInRules(email, password);

  // Re-salted on every run, which is why the account is matched on email. Two admins
  // can hold the same password: bcrypt salts each hash differently.
  const passwordHash = await hash(password, rounds);

  const existing = await prisma.user.findUnique({ where: { email } });

  try {
    if (existing) {
      // Refuse rather than promote. An operator who reuses a customer's address here
      // would otherwise hand that account the administrator role by accident, and this
      // script has no way to tell that apart from a deliberate promotion.
      if (existing.role !== UserRole.ADMIN) {
        throw new Error(
          `${email} already belongs to a ${existing.role} account. Refusing to change it ` +
            'to ADMIN, because that decision should be made deliberately. Promote it ' +
            'directly in the database if that is really what you want.',
        );
      }
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, fullName, phoneNumber, status: UserStatus.ACTIVE },
      });
      console.log(`Reset the password for admin ${email} (${updated.id}).`);
      console.log('Sign in at /api/v1/auth/admin/login, then submit the SMS code.');
      return;
    }

    const created = await prisma.user.create({
      data: {
        email,
        fullName,
        phoneNumber,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
    console.log(`Created admin ${email} (${created.id}).`);
    console.log('Sign in at /api/v1/auth/admin/login, then submit the SMS code.');
  } catch (error) {
    // Only Prisma's unique-constraint failure is translated. Anything else raised above,
    // such as the refusal to promote an existing account, is already a clear message.
    if ((error as { code?: string })?.code === 'P2002') {
      throw new Error(explainConflict(error));
    }
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
