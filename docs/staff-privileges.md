# Staff privileges (backend)

## Access model

Staff share the existing user accounts and dashboard authentication. Supported roles:
`SUPER_ADMIN`, `ADMIN`, `ACCOUNTANT`, `SUPPORT`. Ordinary staff roles are labels;
they grant **no permissions** automatically. Missing permission assignments mean OFF.
Active SUPER_ADMIN accounts have implicit full access. `staff.manage` is reserved
for SUPER_ADMIN and cannot be delegated. `staff.view` can be delegated.

All dashboard requests require the existing httpOnly access cookie. Email/password
and authenticator-app TOTP, password reset, refresh and logout work for every staff
role. Mobile OTP/password/PIN/passkey flows reject staff. Permission checks read the
database on every request; tokens never carry permission grants.

## Migration and provisioning

Run `npx prisma migrate deploy` and `npx prisma generate` before deploying this code.
The enum migration is separate because PostgreSQL must commit new enum values before
the next migration uses them. The permission/bootstrap migration is transactional.

- Existing ADMIN accounts receive explicit operational grants once (all catalog keys
  except `staff.manage`). Newly created staff receive none.
- The existing **ADMIN** account with exact email `admin@fundi.rw` is promoted to
  SUPER_ADMIN. Its password, TOTP enrollment, status and sessions are preserved.
- The migration does not create a missing account or promote a customer who happens
  to use that address. Bootstrap and grant backfill are audited.
- For a fresh installation use the existing `prisma:seed-admin` command with
  `ADMIN_ROLE=SUPER_ADMIN` and the existing ADMIN_EMAIL/FULL_NAME/PHONE_NUMBER/PASSWORD
  variables. The seed defaults new accounts to ADMIN with no grants; it preserves
  the role of existing staff and refuses nonstaff accounts.

A SUPER_ADMIN can create a staff account with `POST /api/v1/users`, supplying a staff
role, name, email and phone. The staff member sets a password via the existing admin
password-reset SMS flow and enrolls TOTP on first sign-in. Account edits, status and
deletion through `/users` require SUPER_ADMIN when the target is staff. Technician
profile management cannot modify a linked staff account. Self-demotion, suspension
or deletion of a SUPER_ADMIN and removal of the last active SUPER_ADMIN are rejected.

## API

All paths below have prefix `/api/v1`. Swagger is served at `/api/docs`.

| Method/path | Permission |
| --- | --- |
| GET `/admin/permissions` | Any active staff session |
| GET `/admin/staff?page=1&limit=20&role=SUPPORT&search=name` | `staff.view` |
| GET `/admin/staff/me/access` | Any active staff session |
| GET `/admin/staff/:staffId/access` | `staff.view` |
| PATCH `/admin/staff/:staffId/permissions` | SUPER_ADMIN |
| PATCH `/admin/staff/:staffId/role` | SUPER_ADMIN |

Single or bulk permission changes use the same endpoint:

```json
{
  "permissions": [
    { "key": "payments.view", "enabled": true },
    { "key": "payments.approve", "enabled": false }
  ]
}
```

Only listed toggles change. Empty batches, duplicate/unknown keys, non-boolean values
and `staff.manage` toggles return 400. The assignment batch and audit entry commit
atomically. Failed audit writes roll back the grants. Editing SUPER_ADMIN toggles
returns 409. Ordinary role changes preserve grants. Entering or leaving SUPER_ADMIN
clears stored grants, so demotion never revives historical assignments.

Role changes use `{ "role": "ACCOUNTANT" }`. Access responses contain identity,
`assignedPermissions`, `effectivePermissions`, and grouped `modules[].permissions`
with `enabled`, `locked`, and `reserved`. Inactive accounts retain configured toggles
but have no effective access. No credential hashes or TOTP secrets are returned.

## Enforcement

Every staff endpoint declares `x-required-permissions` in generated Swagger. Required
keys are AND-combined. Reads, management, approvals and configuration are separate
capabilities. In particular `payments.view` cannot approve claims, and
`technicians.manage` cannot set verification status without `technicians.approve`.
The catalog lists all 34 keys and their descriptions.

Composite dashboard endpoints require `dashboard.view` plus underlying domain reads;
granting dashboard access alone cannot expose payment, staff or other protected data.
Activity/SSE requires `dashboard.view` + `audit.view`; top technicians requires
`dashboard.view` + `technicians.view` + `jobs.view` + `ratings.view`.

Permission and staff account changes emit `staff:access-changed` and disconnect
existing `/chat` and `/events` sockets through the distributed Socket.IO adapter.
Cookies remain valid, so reconnecting obtains the new permissions without logout.
Chat actions recheck the current account, session and permissions. SSE rechecks
permissions/session on every poll (2 seconds) and ends before delivering more rows
after revocation. Payment review notifications go only to accounts with
`payments.view`; stored inbox notifications are filtered again at query time.

## Verification

- `npm run build`
- `npm test -- --runInBand`
- `npx ts-node --transpile-only test/staff-rbac.integration.ts`

The integration test uses PostgreSQL and `psql` with DATABASE_URL from the environment
or `.env`. It creates and removes a uniquely named disposable schema, exercises the
real migrations and bootstrap, then checks HTTP authorization, batch validation,
live revocation, escalation protection, audit rollback, notification filtering and
concurrent super-admin changes. It never resets the configured database.
