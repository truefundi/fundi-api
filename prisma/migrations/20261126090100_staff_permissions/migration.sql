BEGIN;

CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");
CREATE INDEX "permissions_module_sortOrder_idx" ON "permissions"("module", "sortOrder");

CREATE TABLE "staff_permissions" (
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_permissions_pkey" PRIMARY KEY ("userId", "permissionId"),
    CONSTRAINT "staff_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "staff_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "staff_permissions_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "staff_permissions_permissionId_idx" ON "staff_permissions"("permissionId");
CREATE INDEX "staff_permissions_grantedById_idx" ON "staff_permissions"("grantedById");

INSERT INTO "permissions" ("id", "key", "module", "name", "description", "sortOrder")
SELECT md5('fundi.permission.' || key)::uuid::text, key, split_part(key, '.', 1), description, description,
       row_number() OVER (ORDER BY key)::integer
FROM (VALUES
 ('users.view', 'View customer and technician accounts'),
 ('users.manage', 'Create, edit, suspend and delete non-staff accounts'),
 ('technicians.view', 'View technician profiles'),
 ('technicians.manage', 'Manage technician profiles and availability'),
 ('technicians.approve', 'Approve or reject technician applications'),
 ('documents.view', 'View and download technician verification documents'),
 ('documents.review', 'Review technician verification documents'),
 ('companies.view', 'View companies'),
 ('companies.manage', 'Create, edit and delete companies'),
 ('companies.approve', 'Approve or reject company verification'),
 ('jobs.view', 'View jobs, dispatch pipeline and job media'),
 ('jobs.manage', 'Create, edit, cancel, reassign and delete jobs'),
 ('payments.view', 'View booking payments and payment claims'),
 ('payments.manage', 'Manage payment records and booking validity'),
 ('payments.approve', 'Approve or reject manual payment claims'),
 ('payments.configure', 'Configure mobile money payment providers'),
 ('disputes.view', 'View disputes'),
 ('disputes.manage', 'Resolve disputes'),
 ('catalog.view', 'View administrative catalog and pricing'),
 ('catalog.manage', 'Manage categories, services and service charges'),
 ('conversations.view', 'View price negotiation conversations'),
 ('chat.view', 'View chat rooms, messages and attachments'),
 ('chat.send', 'Send staff messages and attachments'),
 ('chat.moderate', 'Moderate rooms, members and messages'),
 ('ratings.view', 'View ratings and rating items'),
 ('ratings.manage', 'Manage ratings and rating items'),
 ('ads.view', 'View advertisements'),
 ('ads.manage', 'Manage advertisements and images'),
 ('broadcasts.view', 'View broadcasts and preview audiences'),
 ('broadcasts.send', 'Send broadcasts'),
 ('dashboard.view', 'View dashboard analytics with underlying domain permissions'),
 ('audit.view', 'View cross-module audit records and activity streams'),
 ('staff.view', 'View staff accounts and access configurations'),
 ('staff.manage', 'Manage staff and privileges (SUPER_ADMIN only)')
) AS catalog(key, description);

-- Preserve operational access explicitly, once. Future admins start with no grants.
INSERT INTO "staff_permissions" ("userId", "permissionId")
SELECT u."id", p."id" FROM "users" u CROSS JOIN "permissions" p
WHERE u."role" = 'ADMIN' AND p."key" <> 'staff.manage';

INSERT INTO "audit_logs" ("id", "entityType", "entityId", "action", "metadata")
SELECT md5('staff.rbac.backfill.' || "id")::uuid::text, 'User', "id", 'STAFF_PERMISSIONS_MIGRATED',
       '{"source":"staff_permissions_migration","reservedStaffManagement":false}'::jsonb
FROM "users" WHERE "role" = 'ADMIN';

-- Only promote the explicitly selected existing administrator; never a customer
-- who happens to have registered this address. Fresh installations use the seed.
INSERT INTO "audit_logs" ("id", "entityType", "entityId", "action", "fromStatus", "toStatus")
SELECT md5('staff.rbac.bootstrap.' || "id")::uuid::text, 'User', "id", 'SUPER_ADMIN_BOOTSTRAPPED', 'ADMIN', 'SUPER_ADMIN'
FROM "users" WHERE "email" = 'admin@fundi.rw' AND "role" = 'ADMIN';
UPDATE "users" SET "role" = 'SUPER_ADMIN', "updatedAt" = CURRENT_TIMESTAMP
WHERE "email" = 'admin@fundi.rw' AND "role" = 'ADMIN';
DELETE FROM "staff_permissions" WHERE "userId" IN (SELECT "id" FROM "users" WHERE "role" = 'SUPER_ADMIN');

-- Previously delivered review notifications must also respect future revocation.
UPDATE "notifications" SET "data" = "data" || '{"requiredPermission":"payments.view"}'::jsonb
WHERE "title" = 'Payment awaiting verification' AND "data" ? 'claimId';

COMMIT;
