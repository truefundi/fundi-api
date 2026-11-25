# Booking Payments API

These endpoints implement a **development-only mock payment** for category
booking fees and record payment data submitted by a frontend. They do not
transfer real money or independently verify payment with a provider. All routes
are prefixed with `/api/v1`.
Customer payment endpoints accept a customer or technician bearer token.
Administrator endpoints require an administrator session or token.

Administrators configure a positive integer `visitFee` for normal requests and
an optional `sosBookingFee` for SOS requests, both in RWF. The SOS fee must be
higher than the normal fee. Administrators may also configure fixed or
percentage service charges, assigning each charge to `CUSTOMER` or `FUNDI`.
Percentage charges are calculated independently from the selected base booking
fee (normal `visitFee` or SOS `sosBookingFee`) and rounded to the nearest
whole RWF. Customer-paid charges are added to the amount due from the customer;
Fundi-paid charges are not. A payment is valid for seven days unless an
administrator extends its lifetime.

## Customer endpoints

### `GET /api/v1/payments/quote`

Returns the current itemized price for an active service. This endpoint is
public and does not create a payment.

Query parameters:

| Name | Required | Values |
| --- | --- | --- |
| `serviceCategoryId` | Yes | Service UUID |
| `requestType` | No | `NORMAL` (default) or `SOS` |

Example response:

```json
{
  "serviceCategory": {
    "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
    "name": "Plumbing"
  },
  "requestType": "NORMAL",
  "currency": "RWF",
  "baseFee": 2500,
  "charges": [
    {
      "id": "5b07bb50-5577-4a14-9f7a-f2758ac8b125",
      "name": "Tax",
      "description": null,
      "chargeType": "PERCENTAGE",
      "value": 10,
      "payer": "CUSTOMER",
      "amount": 250
    },
    {
      "id": "e64e5cbc-4c7e-41a2-88c4-993630ec37df",
      "name": "Platform contribution",
      "description": null,
      "chargeType": "FIXED",
      "value": 200,
      "payer": "FUNDI",
      "amount": 200
    }
  ],
  "customerTotal": 2750,
  "fundiTotal": 200,
  "total": 2950
}
```

The `value` field is the configured fixed amount in RWF or percentage rate;
`amount` is the calculated RWF charge for this request. Percentage values
apply to `baseFee`, not to other charges. Fixed charges must be whole RWF
amounts; percentage rates may not exceed 100%.

### `POST /api/v1/payments/mock`

Creates a successful development payment for an active, priced category. The
customer's account phone number is used unless `phoneNumber` is supplied. The
amount is calculated from the current quote; customer-paid charges are
included, and Fundi-paid charges are excluded.

Request:

```json
{
  "serviceCategoryId": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
  "requestType": "NORMAL",
  "phoneNumber": "+250788123456"
}
```

`phoneNumber` and `requestType` are optional; the request type defaults to
`NORMAL`. Use `SOS` to pay the category's configured `sosBookingFee`. The
amount is not accepted from the client; the API calculates the selected base
fee plus customer-paid charges.

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
    "visitFee": 1000
  },
  "requestType": "NORMAL",
  "phoneNumber": "+250788123456",
  "amount": 1000,
  "pricingDetails": {
    "serviceCategory": { "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30", "name": "Plumbing" },
    "requestType": "NORMAL",
    "currency": "RWF",
    "baseFee": 1000,
    "charges": [
      {
        "id": "5b07bb50-5577-4a14-9f7a-f2758ac8b125",
        "name": "Tax",
        "description": null,
        "chargeType": "PERCENTAGE",
        "value": 25,
        "payer": "CUSTOMER",
        "amount": 250
      }
    ],
    "customerTotal": 1000,
    "fundiTotal": 0,
    "total": 1000
  },
  "currency": "RWF",
  "paidAt": "2026-10-28T12:00:00.000Z",
  "validUntil": "2026-11-04T12:00:00.000Z"
}
```

Save `id` as `paymentId` and submit it when creating a job. Payments are
customer-owned, category-specific, and can be attached to only one job.

### `GET /api/v1/payments/mine`

Returns the signed-in customer or technician's payment history. Each payment
includes the service category, fee, status, timestamps, the saved
`pricingDetails` quote (or `null` for legacy payments), and—when a job has been
created—the job status and technicians who received or accepted offers.
Internal signing secrets are not included in the response.

### `POST /api/v1/payments/processed`

Accepts payment data after the frontend reports that its payment flow
succeeded. The API checks that the category is active, the submitted amount
equals the quote's `customerTotal`, the paid time is not in the future, and the
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
  "requestType": "SOS",
  "externalPaymentId": "frontend-payment-20261028-001",
  "status": "SUCCESS",
  "phoneNumber": "+250788123456",
  "amount": 1000,
  "paidAt": "2026-10-28T12:00:00.000Z"
}
```

The optional `requestType` is `NORMAL` by default or `SOS`. The `status` must
be `SUCCESS`; the amount must equal the corresponding base fee plus all
customer-paid charges. Fundi-paid charges do not increase the customer
amount. A recent payment is stored as `VALID`.
`providerVerified` in the response is `false`. Use the returned `id` as
`paymentId` when creating a job. If `paidAt` is already more than seven days
old, the payment is recorded as `EXPIRED` and cannot be used for a new job.

On amount mismatch, the API returns `400` with the expected total and the
current quote:

```json
{
  "message": "The submitted amount (1000 RWF) does not match the expected customer total (1250 RWF).",
  "expectedAmount": 1250,
  "currency": "RWF",
  "pricingDetails": {
    "serviceCategory": { "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30", "name": "Plumbing" },
    "requestType": "NORMAL",
    "currency": "RWF",
    "baseFee": 1000,
    "charges": [
      {
        "id": "5b07bb50-5577-4a14-9f7a-f2758ac8b125",
        "name": "Tax",
        "description": null,
        "chargeType": "PERCENTAGE",
        "value": 25,
        "payer": "CUSTOMER",
        "amount": 250
      }
    ],
    "customerTotal": 1250,
    "fundiTotal": 0,
    "total": 1250
  }
}
```

Each payment stores a snapshot of its pricing at the time it is recorded.
Editing or deleting a service charge later does not change the pricing details
shown on existing payments. The same saved breakdown is returned in customer
history and administrator payment records.

### `POST /api/v1/payments/claims`

Use this endpoint when a customer or technician says they paid outside the
online flow. A claim is **not** a booking payment and cannot be used to create
a job while it is `PENDING` or `REJECTED`. The submitted amount must exactly
match the current customer total for the selected service and request type.

```json
{
  "serviceCategoryId": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
  "requestType": "NORMAL",
  "amount": 2750,
  "paymentMethod": "MTN",
  "paymentNumber": "+250788123456"
}
```

`requestType` is optional and defaults to `NORMAL`. `paymentMethod` must be
`MTN`, `AIRTEL`, or `CREDIT_CARD`. `paymentNumber` is the transfer destination
or payment reference the administrator needs to verify the claim. For card
payments, send a provider transaction reference or token only; never send a
full card number or security code.

The response contains the claim `id`, status `PENDING`, the selected service,
the claimed amount and method/reference, and `pricingDetails`. No
`bookingPayment` is created until an administrator approves the claim.

If the amount differs from the quote, the endpoint responds `400` with
`expectedAmount` and `pricingDetails`. Correct the amount and resubmit; the
API does not accept a client-selected amount that differs from its quote.

### `GET /api/v1/payments/claims/mine`

Returns all claims submitted by the signed-in customer or technician, newest
first. Each item includes its review status and, when approved, the linked
booking payment details.

An approved claim includes `bookingPayment.id`. Pass that ID as `paymentId`
when creating the job through the existing `POST /jobs` or `POST /jobs/sos`
endpoint. The approved payment is valid for seven days starting at approval.
Pending and rejected claims have no booking payment and cannot advance the job
flow.

## Administrator endpoints

### Payment claim review

| Method | URL | Operation |
| --- | --- | --- |
| `GET` | `/api/v1/admin/payment-claims?status=PENDING` | List claims, optionally filtered by `PENDING`, `APPROVED`, or `REJECTED` |
| `GET` | `/api/v1/admin/payment-claims/:claimId` | Read claim details |
| `PATCH` | `/api/v1/admin/payment-claims/:claimId/review` | Approve or reject a pending claim |
| `DELETE` | `/api/v1/admin/payment-claims/:claimId` | Delete a claim |

Review request:

```json
{
  "status": "APPROVED",
  "reviewNote": "Transfer verified against the MTN statement."
}
```

Use `REJECTED` and an optional `reviewNote` when the payment cannot be
verified. Only pending claims can be reviewed, and each decision is audited.
Approval creates a signed, valid booking payment in the same database
transaction as the claim update; its ID is returned as `bookingPayment.id`.
The claimant can then retrieve it from `GET /payments/claims/mine`. Rejection
does not create a payment. Approval requires the configured
`MOCK_PAYMENT_KEY` and `MOCK_PAYMENT_SECRET`.

Deleting a claim is audited. If it was approved, the issued booking payment
remains available to the job flow; only the claim-to-payment link is removed.

### Service charge configuration

Administrators manage charges per service:

| Method | URL | Operation |
| --- | --- | --- |
| `GET` | `/api/v1/catalog/admin/services/:serviceCategoryId/charges` | List a service's charges |
| `POST` | `/api/v1/catalog/admin/services/:serviceCategoryId/charges` | Add a charge |
| `PATCH` | `/api/v1/catalog/admin/services/:serviceCategoryId/charges/:chargeId` | Update a charge |
| `DELETE` | `/api/v1/catalog/admin/services/:serviceCategoryId/charges/:chargeId` | Delete a charge |

Create request:

```json
{
  "name": "Tax",
  "description": "Service tax",
  "chargeType": "PERCENTAGE",
  "value": 10,
  "payer": "CUSTOMER",
  "sortOrder": 0
}
```

`chargeType` is `FIXED` or `PERCENTAGE`; `payer` is `CUSTOMER` or `FUNDI`.
Fixed values are whole RWF amounts. Percentage values support up to four
decimal places and may not exceed 100. Charges are included in quotes and
payments in `sortOrder`, then name order.

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

| Method   | URL                                           | Operation                                                          |
| -------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `GET`    | `/api/v1/admin/payments/completed`            | List completed-job payments                                        |
| `POST`   | `/api/v1/admin/payments/completed`            | Reconcile a payment for a completed job that has no payment record |
| `GET`    | `/api/v1/admin/payments/completed/:paymentId` | Read one completed-job payment                                     |
| `PATCH`  | `/api/v1/admin/payments/completed/:paymentId` | Update external payment ID, phone, and/or paid time                |
| `DELETE` | `/api/v1/admin/payments/completed/:paymentId` | Delete the payment while retaining a full audit snapshot           |

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

| Status      | Meaning                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `VALID`     | Paid and available to create a job                                                                    |
| `EXPIRED`   | Its validity elapsed while available for reassignment, or both job participants confirmed cooperation |
| `PAUSED`    | A technician accepted the job; the remaining countdown is frozen                                      |
| `RESUMED`   | Validity is counting down again after a cancellation/reassignment                                     |
| `COMPLETED` | Both customer and technician marked the job completed                                                 |

The initial validity is exactly seven days from `paidAt`. Assignment freezes
the remaining validity; customer cancellation or administrator approval of a
technician cancellation resumes it if cooperation has not been mutually
confirmed. Once both job participants confirm cooperation, the payment
immediately becomes `EXPIRED` and `validUntil` is set to the confirmation
time, regardless of its remaining seven-day window. The job remains assigned;
work progress is tracked by the job's `workStatus`. When the job completes
(the customer confirms the technician's `COMPLETED`, or the confirmation window
closes), the payment becomes `COMPLETED`. Cancelling after confirmation
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
