/** Real PostgreSQL migration/transaction and HTTP authorization regression test.
 * Uses a unique disposable schema; never resets the configured database.
 * Run: npx ts-node --transpile-only test/staff-rbac.integration.ts
 */
import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import { PrismaClient, UserRole } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { PermissionsService } from '../src/staff/permissions.service';
import { StaffAccountPolicyService } from '../src/staff/staff-account-policy.service';
import { StaffAccessEventsService } from '../src/staff/staff-access-events.service';
import { StaffService } from '../src/staff/staff.service';
import { StaffController } from '../src/staff/staff.controller';
import { UsersService } from '../src/users/users.service';
import { UsersController } from '../src/users/users.controller';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { EventsGateway } from '../src/websockets/events.gateway';
import { PERMISSION_KEYS } from '../src/staff/permission-catalog';

config({ quiet: true });
const schema = `rbac_test_${randomUUID().replace(/-/g, '')}`;
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set('schema', schema);
const prisma = new PrismaClient({
  datasources: { db: { url: url.toString() } },
});
const db = prisma as PrismaService;
const root = new PrismaClient();
const superId = randomUUID();
const adminId = randomUUID();
const supportId = randomUUID();
const customerId = randomUUID();
let app: INestApplication | undefined;
let invalidations: string[] = [];
const events = {
  invalidate: (id: string) => invalidations.push(id),
} as unknown as StaffAccessEventsService;
const permissions = new PermissionsService(db);
const policy = new StaffAccountPolicyService(permissions);
const audit = new AuditService(db);
const staff = new StaffService(db, permissions, policy, audit, events);
const users = new UsersService(db, policy, permissions, audit, events);

function sql(text: string) {
  const connection = new URL(url);
  connection.searchParams.delete('schema');
  const result = spawnSync(
    'psql',
    [
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--dbname',
      connection.toString(),
    ],
    {
      input: `SET search_path TO "${schema}";\n${text}`,
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (result.status !== 0)
    throw new Error(result.stderr || result.error?.message || 'psql failed');
}

async function main() {
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  // Pre-RBAC tables needed by the production migrations and services under test.
  sql(`
    CREATE TYPE "UserRole" AS ENUM ('CUSTOMER','TECHNICIAN','ADMIN');
    CREATE TYPE "UserStatus" AS ENUM ('ACTIVE','INACTIVE','SUSPENDED');
    CREATE TABLE users (id text PRIMARY KEY, email text UNIQUE, "phoneNumber" text UNIQUE NOT NULL,
      "fullName" text NOT NULL, role "UserRole" NOT NULL, status "UserStatus" NOT NULL DEFAULT 'ACTIVE',
      "passwordHash" text, "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now());
    CREATE TABLE audit_logs (id text PRIMARY KEY, "entityType" text NOT NULL, "entityId" text NOT NULL,
      action text NOT NULL, "fromStatus" text, "toStatus" text, "actorId" text, metadata jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now());
    CREATE TABLE notifications (id text PRIMARY KEY, "userId" text REFERENCES users(id), type text NOT NULL DEFAULT 'SYSTEM',
      title text NOT NULL, body text NOT NULL DEFAULT '', data jsonb, "readAt" timestamp, "createdAt" timestamp NOT NULL DEFAULT now());
    INSERT INTO users(id,email,"phoneNumber","fullName",role,"passwordHash") VALUES
      ('${superId}','admin@fundi.rw','+250788000001','Super','ADMIN','preserved-hash'),
      ('${adminId}','ordinary@example.com','+250788000002','Admin','ADMIN',null),
      ('${customerId}','customer@example.com','+250788000003','Customer','CUSTOMER',null);
    INSERT INTO notifications(id,"userId",title,data) VALUES ('legacy','${adminId}','Payment awaiting verification','{"claimId":"claim"}');
  `);
  sql(
    readFileSync(
      'prisma/migrations/20261126090000_staff_roles/migration.sql',
      'utf8',
    ),
  );
  sql(
    readFileSync(
      'prisma/migrations/20261126090100_staff_permissions/migration.sql',
      'utf8',
    ),
  );

  const bootstrap = await prisma.user.findUnique({
    where: { id: superId },
    select: { role: true, status: true, passwordHash: true },
  });
  assert.deepEqual(bootstrap, {
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    passwordHash: 'preserved-hash',
  });
  assert.equal(await prisma.permission.count(), PERMISSION_KEYS.length);
  assert.equal(
    await prisma.staffPermission.count({ where: { userId: adminId } }),
    PERMISSION_KEYS.length - 1,
  );
  assert.equal(
    await prisma.staffPermission.count({ where: { userId: superId } }),
    0,
  );
  assert.equal(
    await prisma.staffPermission.count({ where: { userId: customerId } }),
    0,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { action: 'SUPER_ADMIN_BOOTSTRAPPED' },
    }),
    1,
  );

  await users.create(
    {
      fullName: 'Support',
      email: 'support@example.com',
      phoneNumber: '+250788000004',
      role: UserRole.SUPPORT,
    },
    superId,
  );
  const support = await prisma.user.findUniqueOrThrow({
    where: { email: 'support@example.com' },
    select: { id: true },
  });
  // Stable identity for HTTP fixtures.
  await prisma.$executeRaw`UPDATE users SET id = ${supportId} WHERE id = ${support.id}`;
  assert.deepEqual((await permissions.access(supportId)).permissions, []);
  await assert.rejects(
    users.create(
      {
        fullName: 'Escalation',
        email: 'bad@example.com',
        phoneNumber: '+250788000005',
        role: UserRole.SUPER_ADMIN,
      },
      adminId,
    ),
  );
  await assert.rejects(
    users.update(customerId, { role: UserRole.SUPER_ADMIN }, adminId),
  );
  await assert.rejects(users.updateStatus(superId, 'INACTIVE', adminId));
  await assert.rejects(users.delete(superId, adminId));
  await assert.rejects(users.updateStatus(superId, 'INACTIVE', superId));
  await assert.rejects(users.delete(superId, superId));
  await assert.rejects(users.updateAccount(superId, { fullName: 'Bypass' }));
  await assert.rejects(users.switchRole(superId, UserRole.CUSTOMER));
  await assert.rejects(staff.updateRole(superId, superId, UserRole.ADMIN));

  const module = await Test.createTestingModule({
    controllers: [StaffController, UsersController, PaymentsController],
    providers: [
      { provide: PermissionsService, useValue: permissions },
      { provide: StaffService, useValue: staff },
      { provide: UsersService, useValue: users },
      {
        provide: PaymentsService,
        useValue: {
          listAll: () => ['payment'],
          reviewPaymentClaim: () => ({ reviewed: true }),
        },
      },
    ],
  })
    .overrideGuard(AuthGuard('jwt'))
    .useValue({
      canActivate: async (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const id = req.headers['x-user'];
        if (!id) throw new UnauthorizedException();
        const user = await prisma.user.findUnique({
          where: { id },
          select: { id: true, role: true },
        });
        if (!user) throw new UnauthorizedException();
        req.user = { userId: user.id, role: user.role };
        req.authMethod = req.headers['x-method'] ?? 'cookie';
        return true;
      },
    })
    .compile();
  app = module.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  const http = app.getHttpServer();
  const endpoint = `/api/v1/admin/staff/${supportId}/permissions`;
  await request(http).get('/api/v1/admin/staff').expect(401);
  await request(http)
    .get('/api/v1/admin/staff')
    .set('x-user', customerId)
    .expect(403);
  await request(http)
    .get('/api/v1/admin/payments')
    .set('x-user', supportId)
    .expect(403);
  await request(http)
    .get('/api/v1/admin/staff/me/access')
    .set('x-user', supportId)
    .expect(200);
  await request(http)
    .patch(endpoint)
    .set('x-user', adminId)
    .send({ permissions: [{ key: 'payments.view', enabled: true }] })
    .expect(403);
  for (const payload of [
    { permissions: [] },
    { permissions: [{ key: 'unknown', enabled: true }] },
    { permissions: [{ key: 'payments.view', enabled: 'true' }] },
    {
      permissions: [
        { key: 'payments.view', enabled: true },
        { key: 'payments.view', enabled: false },
      ],
    },
    { permissions: [{ key: 'staff.manage', enabled: true }] },
  ])
    await request(http)
      .patch(endpoint)
      .set('x-user', superId)
      .send(payload)
      .expect(400);
  await request(http)
    .patch(`/api/v1/admin/staff/${superId}/permissions`)
    .set('x-user', superId)
    .send({ permissions: [{ key: 'payments.view', enabled: false }] })
    .expect(409);
  await request(http)
    .patch(endpoint)
    .set('x-user', superId)
    .send({
      permissions: [
        { key: 'payments.view', enabled: true },
        { key: 'jobs.view', enabled: true },
      ],
    })
    .expect(200);
  await request(http)
    .get('/api/v1/admin/payments')
    .set('x-user', supportId)
    .expect(200);
  await request(http)
    .get('/api/v1/admin/payments')
    .set('x-user', supportId)
    .set('x-method', 'bearer')
    .expect(403);
  await request(http)
    .patch(`/api/v1/admin/payment-claims/${randomUUID()}/review`)
    .set('x-user', supportId)
    .send({ status: 'APPROVED' })
    .expect(403);
  await request(http)
    .patch(endpoint)
    .set('x-user', superId)
    .send({ permissions: [{ key: 'payments.view', enabled: false }] })
    .expect(200);
  await request(http)
    .get('/api/v1/admin/payments')
    .set('x-user', supportId)
    .expect(403);
  assert.deepEqual((await permissions.access(supportId)).permissions, [
    'jobs.view',
  ]);

  const beforeAudit = await prisma.auditLog.count();
  invalidations = [];
  const failing = new StaffService(
    db,
    permissions,
    policy,
    {
      log: async () => {
        throw new Error('audit unavailable');
      },
    } as unknown as AuditService,
    events,
  );
  await assert.rejects(
    failing.updatePermissions(superId, supportId, {
      permissions: [
        { key: 'jobs.view', enabled: false },
        { key: 'payments.approve', enabled: true },
      ],
    }),
  );
  assert.deepEqual((await permissions.access(supportId)).permissions, [
    'jobs.view',
  ]);
  assert.equal(await prisma.auditLog.count(), beforeAudit);
  assert.deepEqual(invalidations, []);
  await staff.updateRole(superId, supportId, UserRole.ACCOUNTANT);
  assert.deepEqual((await permissions.access(supportId)).permissions, [
    'jobs.view',
  ]);
  await staff.updateRole(superId, supportId, UserRole.SUPER_ADMIN);
  assert.equal(
    (await permissions.access(supportId)).permissions.length,
    PERMISSION_KEYS.length,
  );
  await staff.updateRole(superId, supportId, UserRole.SUPPORT);
  assert.deepEqual((await permissions.access(supportId)).permissions, []);

  const notifications = new NotificationsService(
    db,
    {} as EventsGateway,
    audit,
    permissions,
  );
  assert.equal(
    (await notifications.list(adminId, { limit: 20, offset: 0 })).total,
    1,
  );
  await staff.updatePermissions(superId, adminId, {
    permissions: [{ key: 'payments.view', enabled: false }],
  });
  assert.equal(
    (await notifications.list(adminId, { limit: 20, offset: 0 })).total,
    0,
  );
  assert.equal((await notifications.unreadCount(adminId)).count, 0);
  await assert.rejects(notifications.markRead(adminId, 'legacy'));

  await staff.updateRole(superId, supportId, UserRole.SUPER_ADMIN);
  const races = await Promise.allSettled([
    staff.updateRole(superId, supportId, UserRole.ADMIN),
    staff.updateRole(supportId, superId, UserRole.ADMIN),
  ]);
  assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    await prisma.user.count({
      where: { role: UserRole.SUPER_ADMIN, status: 'ACTIVE' },
    }),
    1,
  );
  console.log(
    'PASS: RBAC migration, bootstrap, HTTP validation, live grants/revocation, escalation protection, atomic audit rollback, notification filtering and concurrent super-admin changes.',
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await app?.close();
    await prisma.$disconnect();
    await root.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await root.$disconnect();
  });
