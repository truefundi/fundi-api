# Admin API performance — 2026-11-26

## Audit and priorities

The API is a NestJS modular monolith using PostgreSQL/PostGIS, Prisma 6, a shared
global `PrismaService`, and BullMQ/Redis workers. Admin routes enforce staff
authentication and permissions before invoking domain services.

| Priority  | Confirmed finding                                                        | Implemented improvement                                                                                                              |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| High      | Jobs/Payments loaded entire collections with detail relations            | Opt-in database pagination, lightweight selections, filters and stable sorting                                                       |
| High      | Legacy payment listing writes expiration updates and transfers histories | Read-only effective expiration; one lateral query with per-job `LIMIT 1`                                                             |
| High      | Dashboard requests repeatedly execute overlapping queries                | 15-second response cache, concurrent request coalescing, four shared concurrent aggregates, removal of a redundant payment aggregate |
| Medium    | Global ordering and audit cursor scans lacked matching indexes           | Five index definitions and a deployment migration                                                                                    |
| Medium    | Admin job creation fetched customer details before admin details         | Fetch the admin representation directly after creation                                                                               |
| Follow-up | Each dashboard SSE client polls PostgreSQL every two seconds             | Audit cursor index prepared; shared polling/event fan-out remains follow-up work                                                     |

Prisma relation reads were batched, rather than a query per returned parent, but
still loaded excessive data. Query logging confirmed that nested `take: 1` on
assignment history fetched all matching histories before trimming in the engine.
The replacement bounds returned history rows in PostgreSQL and can use the
existing `job_assignment_history(jobId, acceptedAt)` index.

## Measurements

Read-only service/database measurements on a small local dataset (10 jobs,
13 payments), before deploying the new indexes:

| Operation                                  |     SQL statements | JSON bytes | Latest elapsed time |
| ------------------------------------------ | -----------------: | ---------: | ------------------: |
| Legacy Jobs, 10 rows (earlier baseline)    |                 17 |     33,762 |                   — |
| Paginated Jobs, limit 10                   |                  8 |      8,148 |             77.4 ms |
| Paginated Jobs, limit 5                    |                  8 |      4,139 |             27.7 ms |
| Paginated Payments, limit 10               |                  6 |     10,923 |             22.0 ms |
| Payments summary                           |                  5 |        318 |             25.9 ms |
| Cold concurrent overview/trends/breakdowns | 56 (previously 61) |      8,218 |            145.9 ms |
| Same dashboard requests, cached            |                  0 |      8,218 |              3.1 ms |

Jobs with the same 10 records used **76% fewer response bytes and 53% fewer SQL
statements**. Summary counts include transaction statements; Payments includes
the batched latest-assignment query. Counts vary with related-row presence.

These are individual local samples, not production latency percentiles or a load
test. They exclude HTTP guards, network and browser rendering. Cache hits still
run authentication/authorization in real requests. The legacy Jobs baseline used
the previously compiled service during schema/client drift; new measurements
execute current TypeScript. Timing comparisons across those builds are not
claimed. Earlier frontend observations included development route compilation up
to 13.7 seconds and 12-second page timeouts; backend measurements did not establish
the API as the cause of those delays.

Reproduce with `npm run profile:admin`. It loads `DATABASE_URL`, enables PostgreSQL
read-only mode and a five-second statement timeout, calls services without booting
workers, and prints counts/timings/bytes rather than records. Assertions check
disjoint pages, status filters, SQL totals, effective expiration and cache hits.

## Frontend integration

Paths below are relative to `/api/v1`. Existing cookie authentication and
`jobs.view`/`payments.view` permissions apply.

### Dual list contract

- `GET /admin/jobs` and `GET /admin/payments` without query parameters retain
  legacy arrays and behavior.
- Any supported supplied query parameter opts into a lightweight page. Send
  `page=1&limit=20` explicitly to get the performance improvement.
- Defaults: page 1, limit 20; maximum limit 100. Invalid/unknown parameters return 400. Search is trimmed, nonempty, case-insensitive substring matching (max 200
  characters). ID filters require UUID v4 values.
- Filters combine with AND. Sorting adds `id ASC` as a stable tie-breaker. Empty
  collections have `totalPages: 0`; out-of-range pages return empty `data` and the
  requested page. Count and list run independently, so concurrent writes can
  briefly change membership/totals. These are not snapshot exports.

```http
GET /api/v1/admin/jobs?page=1&limit=20&group=matching&priority=HIGH&sortBy=createdAt&sortOrder=desc
GET /api/v1/admin/payments?page=1&limit=20&status=EXPIRED&sortBy=amount&sortOrder=desc
GET /api/v1/admin/payments/summary?from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z
```

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

### Jobs

Supported fields: `page`, `limit`, `search`, `status`, `group`, `priority`,
`requestType`, `serviceCategoryId`, `customerId`, `technicianId`, `sortBy`,
`sortOrder`. Sort fields: `createdAt` (default), `updatedAt`, `priority`,
`offeredAmount`; direction: `asc` or `desc` (default). Priority follows database
enum order. Search covers reference, description, address, custom/catalog service
name, customer name and assigned technician name.

Groups: `matching` = OPEN; `in_progress` = ASSIGNED/PAUSED;
`completed` = COMPLETED; `cancelled` = CANCELLED/FAILED;
`disputed` = unresolved dispute. A supplied `status` further restricts the group.

Rows contain reference, description, service/serviceCategory, location, customer,
currentTechnician, status, priority, requestType, offeredAmount, currency,
createdAt/updatedAt/completedAt, bookingPayment (amount/status), and dispute
(id/resolvedAt). Histories, offers, media, full ratings and signed image URLs
belong to `GET /admin/jobs/:jobId`.

Update the frontend mapper for the summary dispute object and nullable relations.
Send `priority`, rather than a UI-only `urgency` key, and service UUIDs rather than
names. Keep list rows separate from full detail-cache records. Admin creation
still returns the admin detail representation, with one detail read.

### Payments

Supported fields: `page`, `limit`, `search`, `status`, `requestType`, `customerId`,
`serviceCategoryId`, `from`, `to`, `sortBy`, `sortOrder`. Sort fields: `paidAt`
(default), `createdAt`, `amount`, `validUntil`. Search covers external payment ID,
payment/customer phone, customer name, service name, job reference/description.
Dates filter `paidAt` using inclusive `from`, exclusive `to`; `from < to` when both
are present. Send timezone-qualified ISO timestamps.

Rows retain payment summary fields and customer/service/job summaries, with
`currency: "RWF"`. They omit pricing snapshots/details, signatures and payment
keys. `job.assignmentHistory` contains zero or one latest assignment. VALID/RESUMED
payments with `validUntil <= request time` are reported and filtered as EXPIRED
without writing to storage. PAUSED remains PAUSED.

`GET /admin/payments/summary` uses the same filters, ignores paging/sorting, and
returns `{ total, amount, currency, byStatus: [{ status, count, amount }],
generatedAt }`. All statuses appear, including zeros. Two aggregates run in a
repeatable-read transaction and adjust overdue totals consistently. `amount` sums
matching booking-payment amounts; it is not net revenue or a settlement ledger.
Status filtering also scopes the summary.

Use the summary for financial cards instead of summing the current page or loading
all records. Use the existing completed-payment detail route when pricing details
are needed for a completed payment.

### Request state and freshness

Use `data` for rows and server metadata for pagination; remove client-side
whole-collection slicing/filtering/sorting. Reset page to 1 when filters change,
debounce search, and include every query field in request-cache keys. Invalidate
list, summary and detail queries after relevant mutations.

Overview, trends, breakdowns and top-technicians responses are cached per API
process for 15 seconds after computation completes, with up to 100 keys per cache.
Identical pending calls share work; failures are evicted. Keys include endpoint,
all filters and resolved date/timezone range. Shared aggregates coalesce only
while pending, preventing stacked TTLs. Observed SSE audit activity clears both
caches on that process. This is not distributed mutation invalidation; cached
results can remain until TTL expiry when no event is observed. Use `generatedAt`
to show freshness.

## Deployment and infrastructure

`prisma/migrations/20261126120000_admin_query_indexes/migration.sql` adds:

- Jobs `(createdAt DESC, id)`, `(status, createdAt DESC, id)`, `(completedAt)`.
- Booking payments `(paidAt DESC, id)`.
- Audit logs `(createdAt, id)`.

The migration is prepared, not applied by this task. Ordinary `CREATE INDEX` can
block writes while building; schedule for production table sizes. Validate plans
with `EXPLAIN (ANALYZE, BUFFERS)` on representative staging data after rollout;
tiny local tables do not establish an index latency gain.

The final `prisma migrate status` reported three pending migrations: staff roles,
staff permissions, and these indexes. The earlier job-progress migration is now
applied. Four database migrations were absent locally:
`20261114100000_push_tokens`, `20261117090000_default_rating_items`,
`20261118090000_technician_rejection_reason`, and
`20261120090000_company_rejection_reason`. Reconcile that history with the owning
deployment before the normal migration rollout. Generate the client from the
final schema and deploy the built API. Local generation initially hit a Windows
engine-DLL lock held by the running server; verification used temporary-output
client generation. This task performed no migrations or API restarts.

Pooling inspection found one shared Prisma client provider, not one per request.
The inspected local URL has no explicit `connection_limit`, `pool_timeout` or
`pgbouncer` parameters, and no `DIRECT_URL` is configured. Production pool/proxy
configuration was unavailable. Size the connection budget across replicas/workers
against PostgreSQL capacity using measured pool waits/concurrent demand; do not
blindly increase the pool to accommodate cold dashboard fan-out.

## Remaining bottlenecks

1. Legacy unbounded lists and legacy Payments expiration writes remain costly
   until frontend pagination adoption. Completed-payment listing is also unbounded.
2. Per-client SSE polling and session/permission checks scale with open tabs.
   Shared polling or publish/subscribe must preserve authorization checks.
3. Cold analytics still executes 56 statements for the measured batch. Evaluate
   pre-aggregation/materialized summaries or cross-process caching if load warrants.
4. Substring searches, exact counts and deep offsets can scan large datasets.
   Evaluate trigram indexes/cursors against actual plans and product requirements.
5. Sequential database-backed authentication/permission reads add request cost;
   consolidation must preserve account/session revocation semantics.
6. Full-detail media signing, technician matching and provider work can lengthen
   mutations. BullMQ workers already exist and password hashing is async; no
   synchronous filesystem/child-process/crypto call was found in inspected source
   paths. Profile slow mutations before queuing more work with durable retries.

## Changed files and verification

- Shared: `src/common/dto/admin-list-query.dto.ts`, `src/common/pagination.ts`.
- Jobs: `src/jobs/admin-job-list.ts`, `jobs.service.ts`,
  `admin-jobs.controller.ts`, new list/page DTOs and list/create tests.
- Payments: `src/payments/admin-payment-list.ts`, `payments.service.ts`,
  `payments.controller.ts`, new list/page DTOs and list/summary tests.
- Dashboard: `src/admin/dashboard-cache.ts`, dashboard service/controller,
  `dashboard-cache.spec.ts`, `admin-list.http.spec.ts`.
- Database/profiling: five index entries in `prisma/schema.prisma`, index migration,
  `scripts/profile-admin-queries.cjs`, `package.json` profiling command, and a
  targeted `.gitignore` exception for the reproducible profiling script.
- Documentation: this guide, `openapi.yaml`, and controller/DTO Swagger descriptions.

Verification covers HTTP validation, legacy contracts, guards/permissions,
Swagger, pagination/filtering, effective expiry, summary accounting, bounded
assignment lookup, cache concurrency/expiry/failures, and existing Jobs/Payments/
dashboard regressions. HTTP tests substitute JWT authentication and retain actual
role/permission guards; the database profiler bypasses live HTTP authentication.
Concurrent staff-permission changes in the working tree are separate work.

Final results: **11 suites / 120 tests passed**, full `npx tsc --noEmit
--incremental false` passed, scoped ESLint passed without warnings, Prisma schema
validation passed, and `git diff --check` passed. Read-only profiling assertions
passed. `prisma migrate status` reported the deployment drift described above.
