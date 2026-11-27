# Implementation Roadmap

This is a day-by-day sequence of deliverables. Each day should end with a schema migration, tests, endpoint documentation, and a review of the acceptance checks for that phase. Dates can be assigned when work sessions are scheduled; the day numbers define order rather than calendar commitments.

## Day 1: Service Categories

**Status: Complete (2026-10-01)**

- Admin create, list, lookup by ID/name, update, and deactivate categories.
- Public list, lookup by ID, and partial-name search for active categories.
- Enforce admin authorization and audit category mutations.
- Acceptance: category endpoints are wired, database migration is applied, duplicate/invalid/not-found cases have clear responses, tests pass, and the API guide is published. Verified with 6 catalog unit tests, 4 e2e tests, a clean build, and 10 seeded categories.

## Day 2: Technician Profiles, Verification, and Availability

**Status: Complete (2026-10-01)**

- Let a signed-in technician update user identity and profile fields in one transaction, including gender, experience, active categories, address, GPS coordinates, and optional binary profile photo.
- Let administrators create, update, delete, search, and review technicians; keep `PENDING`/`APPROVED`/`REJECTED` verification separate from user active status and `ONLINE`/`OFFLINE` availability.
- Let customers browse only active, approved, online technicians and retrieve a selected technician's full profile.
- Store coordinates in decimal degrees and synchronize a PostGIS `geography(Point,4326)` for later spatial matching. Do not filter by service radius until job dispatch is implemented.
- Acceptance: updates across user/profile/category tables commit atomically; only active categories can be assigned; unapproved/inactive technicians cannot be online; search returns every match; image bytes are validated and returned as a data URL. Verified with 12 technician unit tests, 10 e2e tests, a clean build, and the applied migration.

## Day 3: Technician Documents and Verification

- Securely upload profile images, IDs, and licenses to S3-compatible storage.
- Add document metadata, size/type validation, and private download authorization.
- Add document uploads and KYC review details to the verification states introduced on Day 2.
- Acceptance: documents are private, state transitions are audited, and incomplete submissions are rejected with a checklist.

## Day 4: Job Request and Diagnostic Payment

- Create customer job requests and match eligible, available technicians by category and PostGIS service radius.
- Require successful platform payment authorization for the diagnostic/visit fee before dispatch.
- Acceptance: no job reaches dispatch before diagnostic payment succeeds; payment data is tokenized by the gateway.

## Day 5: Repair Quote and Customer Approval

- Let the assigned technician submit separate parts and labor amounts.
- Calculate the total server-side and collect explicit customer approval before repair work.
- Acceptance: quote status and amounts are validated; unapproved quotes cannot proceed to repair.

## Day 6: Completion and Settlement Tracking

- Complete jobs and record `FUNDI_GATEWAY`, `CASH`, `E_TRANSFER`, or `OTHER` settlement.
- Capture off-platform amounts for GMV reporting without processing those funds.
- Acceptance: technicians must declare a settlement method; job, payment, and audit records remain consistent.

## Day 7: Receipts, Disputes, and Protection

- Generate itemized receipts separating diagnostic and repair amounts.
- Mark gateway-paid repairs as eligible for dispute/protection workflows.
- Add admin dispute review and immutable audit history.
- Acceptance: receipt totals reconcile with payment/job records and eligibility is derived from payment status.

## Day 8: Reliability and Release Readiness

- Add retry/offline-safe mobile workflows, idempotency, rate limits, monitoring, security review, and end-to-end scenarios.
- Review backups, environment configuration, deployment, and operational runbooks.
- Acceptance: documented recovery behavior, passing integration tests, and no secrets or raw payment credentials in logs/storage.
