# Booking Payments API

These endpoints implement a **development-only mock payment** for category
booking fees and record payment data submitted by a frontend. They do not
transfer real money or independently verify payment with a provider. All routes
are prefixed with `/api/v1`.
Customer payment endpoints accept a customer or technician bearer token.
Administrator endpoints require an administrator session or token.

Administrators configure a positive integer `bookingFee` in RWF on each
service category. A customer must pay that exact fee before creating a job
for the category. A mock payment is valid for seven days unless an administrator
extends its lifetime.

## Customer endpoints

### `POST /api/v1/payments/mock`

Creates a successful development payment for an active, priced category. The
customer's account phone number is used unless `phoneNumber` is supplied.

Request:

```json
{
  "serviceCategoryId": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
  "phoneNumber": "+250788123456"
}
```

`phoneNumber` is optional. The amount is not accepted from the client; it is
read from the category's configured `bookingFee`.

Success response (`201`):

```json
{
  "id": "a44a6586-6681-46ae-9c4a-86b4a83ae218",
  "externalPaymentId": "mock_6efc01fd-85fd-41bd-b02b-ce2ddfc0f590",
  "status": "SUCCESS",
  "bookingStatus": "VALID",
  "serviceCategory": {
    "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
    "name": "Plumbing",
    "bookingFee": 1000
  },
  "phoneNumber": "+250788123456",
  "amount": 1000,
  "currency": "RWF",
  "paidAt": "2026-10-28T12:00:00.000Z",
  "validUntil": "2026-11-04T12:00:00.000Z"
}
```

Save `id` as `paymentId` and submit it when creating a job. Payments are
customer-owned, category-specific, and can be attached to only one job.

### `GET /api/v1/payments/mine`

Returns the signed-in customer or technician's payment history. Each payment includes the service
category, fee, status, timestamps, and—when a job has been created—the job
status and technicians who received or accepted offers. Internal signing
secrets are not included in the response.

### `POST /api/v1/payments/processed`

Accepts payment data after the frontend reports that its payment flow
succeeded. The API checks that the category is active, the submitted amount
equals its configured booking fee, the paid time is not in the future, and the
external payment ID has not already been recorded. It then creates a payment
valid for seven days from `paidAt`.

This route **does not verify that money was actually received**. It is
disabled when `NODE_ENV=production` and must only be used in a trusted
development/test environment. A real production flow must verify a provider
webhook/signature or query the provider from the backend before making a
payment available for job creation.

Request:

```json
{
  "serviceCategoryId": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
  "externalPaymentId": "frontend-payment-20261028-001",
  "status": "SUCCESS",
  "phoneNumber": "+250788123456",
  "amount": 1000,
  "paidAt": "2026-10-28T12:00:00.000Z"
}
```

The `status` must be `SUCCESS`; a recent payment is stored as `VALID`.
`providerVerified` in the response is `false`. Use the returned `id` as
`paymentId` when creating a job. If `paidAt` is already more than seven days
old, the payment is recorded as `EXPIRED` and cannot be used for a new job.

## Administrator endpoints

### `GET /api/v1/admin/payments`

Lists payments across customers, including associated jobs and assignment
history. Payment signing secrets are excluded.

### `PATCH /api/v1/admin/payments/:paymentId/extend`

Extends a payment's remaining validity by 1–30 days.

Request:

```json
{
  "days": 7
}
```

An expired payment becomes `RESUMED` with a new validity window. If the
payment is paused because a technician has accepted the job, the added days
increase its remaining validity without starting its countdown. Completed
payments and payments expired after both job participants confirmed
cooperation cannot be extended.

### Completed-job payment CRUD

The following administrator routes manage only payments whose payment status
and associated job status are both `COMPLETED`:

| Method | URL | Operation |
| --- | --- | --- |
| `GET` | `/api/v1/admin/payments/completed` | List completed-job payments |
| `POST` | `/api/v1/admin/payments/completed` | Reconcile a payment for a completed job that has no payment record |
| `GET` | `/api/v1/admin/payments/completed/:paymentId` | Read one completed-job payment |
| `PATCH` | `/api/v1/admin/payments/completed/:paymentId` | Update external payment ID, phone, and/or paid time |
| `DELETE` | `/api/v1/admin/payments/completed/:paymentId` | Delete the payment while retaining a full audit snapshot |

Create request (the amount and customer are taken from the completed job and
its category):

```json
{
  "jobId": "a44a6586-6681-46ae-9c4a-86b4a83ae218",
  "externalPaymentId": "reconciled-payment-001",
  "phoneNumber": "+250788123456",
  "paidAt": "2026-10-28T12:00:00.000Z"
}
```

Update request example:

```json
{
  "externalPaymentId": "corrected-provider-reference",
  "phoneNumber": "+250788123456"
}
```

Deletion is audited with the original payment details; it does not erase the
audit record. These administrative reconciliation operations do not change
the completed job's status.

## Payment statuses and lifetime

| Status | Meaning |
| --- | --- |
| `VALID` | Paid and available to create a job |
| `EXPIRED` | Its validity elapsed while available for reassignment, or both job participants confirmed cooperation |
| `PAUSED` | A technician accepted the job; the remaining countdown is frozen |
| `RESUMED` | Validity is counting down again after a cancellation/reassignment |
| `COMPLETED` | Both customer and technician marked the job completed |

The initial validity is exactly seven days from `paidAt`. Assignment freezes
the remaining validity; customer cancellation or administrator approval of a
technician cancellation resumes it if cooperation has not been mutually
confirmed. Once both job participants confirm cooperation, the payment
immediately becomes `EXPIRED` and `validUntil` is set to the confirmation
time, regardless of its remaining seven-day window. The job remains assigned;
work progress is tracked independently. If both participants later mark the
job completed, the payment becomes `COMPLETED`. Cancelling after confirmation
does not resume the payment or reopen the job for reassignment.

When work is paused before mutual confirmation, the job remains assigned and
the payment countdown stays frozen. Both parties can still confirm cooperation
while the job is paused; the second confirmation expires the payment
immediately.

Expiration is enforced when a payment is used and its status is materialized
when payment history or a relevant booking operation checks it; a background
expiry worker is not currently used.

The signing keys are `MOCK_PAYMENT_KEY` and `MOCK_PAYMENT_SECRET` in `.env`.
Use random development-only values. These are not credentials for a real
payment provider and must not be used as such.
