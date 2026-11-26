# MTN / Airtel payment modes

All routes use `/api/v1`. This backend supports separate MTN and Airtel dashboard
toggles. Both default to **manual**. The API flow currently simulates immediate
success in `NODE_ENV=development` or `test`; it never calls a payment provider or
moves money. Real provider collection, callbacks, and reconciliation must be
integrated before enabling production API payments.

## Setup

Apply the migration and regenerate the client before starting the server:

```sh
npx prisma migrate deploy
npx prisma generate
```

Set `MOCK_PAYMENT_KEY` and `MOCK_PAYMENT_SECRET` for payment record signing.
These are internal signing values, not provider credentials. Existing manual
claim approval also requires these settings.

## Dashboard toggles

Admin routes require the dashboard's httpOnly cookie session. Browser requests
must use `credentials: 'include'`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/admin/payment-providers` | Read both independent toggles |
| PATCH | `/admin/payment-providers/MTN` | Change MTN mode |
| PATCH | `/admin/payment-providers/AIRTEL` | Change Airtel mode |

Enable a provider with `{ "apiEnabled": true }`; switch it to manual with
`{ "apiEnabled": false }`. The boolean is required. Each change is audited.
Enabling one provider does not enable the other.

Example provider response:

```json
{
  "provider": "MTN",
  "apiEnabled": true,
  "mode": "API",
  "apiAvailable": true,
  "executionMode": "SIMULATED",
  "updatedAt": "2026-11-24T12:00:00.000Z"
}
```

`apiEnabled` is the saved preference. **`mode` is the effective client flow.**
`apiAvailable` indicates whether this runtime supports API mode, not provider
health or signing-key readiness. Outside development/test, enabling is rejected
with `503`; even a saved enabled preference resolves to `mode: "MANUAL"`,
`apiAvailable: false`, and `executionMode: "UNAVAILABLE"`. Disabling remains
available in every environment.

## Client checkout

First fetch public `GET /payments/providers`. It returns an array with MTN and
Airtel in the format above. Refresh it when opening checkout and after a `409`
mode conflict. Prices still come from `GET /payments/quote`.

### API mode (development simulation)

1. Show a phone input for the selected provider.
2. Generate a UUID v4 idempotency key **once per payment**, and retain it on retries.
3. On Pay, send the following with the customer/technician bearer token:

```http
POST /api/v1/payments/initiate
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "provider": "MTN",
  "serviceCategoryId": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
  "requestType": "NORMAL",
  "phoneNumber": "0788123456",
  "idempotencyKey": "a44a6586-6681-46ae-9c4a-86b4a83ae218"
}
```

`provider` is `MTN` or `AIRTEL`; `requestType` defaults to `NORMAL` and also
supports `SOS`. Phone numbers use the existing Rwanda normalization rules.
The service must be supplied by UUID. Amount and success status are calculated
by the server and cannot be supplied by the client.

The `201` response includes:

```json
{
  "id": "926dce62-f269-4f72-8a04-89a7a8334a91",
  "provider": "MTN",
  "status": "SUCCESS",
  "simulated": true,
  "providerVerified": false,
  "amount": 2750,
  "currency": "RWF",
  "bookingPaymentId": "ea2f7b88-a70a-4ec9-a079-d4e06afff830",
  "bookingPayment": {
    "id": "ea2f7b88-a70a-4ec9-a079-d4e06afff830",
    "status": "VALID",
    "paidAt": "2026-11-24T12:00:00.000Z",
    "validUntil": "2026-12-01T12:00:00.000Z",
    "jobId": null
  }
}
```

The full response also includes the service UUID, request type, normalized phone,
external reference, timestamps, and frozen `pricingDetails`.

Pass **`bookingPaymentId`**, not the transaction `id`, as `paymentId` when
creating the normal or SOS job. The existing seven-day booking validity and
single-job attachment rules apply.

Repeating the same request/key returns the original transaction without creating
another payment or notification, even after the provider is switched to manual.
Reusing a key with different payment details returns `409`. Keys are scoped to
the authenticated user. A pending manual claim for the same service/request type
blocks a new API payment until that claim is reviewed.

Recover a result using owner-only `GET /payments/transactions/:transactionId`.
If the initial HTTP response was lost, retry `POST /payments/initiate` with the
original key. Transaction status (`SUCCESS`) is independent of booking validity
(`VALID`, `EXPIRED`, `PAUSED`, etc.).

### Manual mode

Use the existing external-payment flow:

1. Customer pays externally.
2. Customer submits `POST /payments/claims` with the amount, service, request
   type, `paymentMethod`, and `paymentNumber`.
3. Claim remains `PENDING`, with **no booking payment**, until verified.
4. Admin checks the transfer, then calls
   `PATCH /admin/payment-claims/:claimId/review` with `APPROVED` or `REJECTED`.
5. Only approval creates the booking payment needed to submit the job.

New MTN/Airtel claims require that provider's effective mode to be `MANUAL`.
New initiation requests require `API`. The server enforces both checks, including
when the client has stale settings. Existing pending claims can still be reviewed
after the mode changes. Credit-card claims retain their existing manual flow.

See [booking-payments.md](booking-payments.md) for the claim/review payloads.

## Realtime updates

Connect to Socket.IO namespace `/events` before clicking Pay:

```js
// Customer / technician
const socket = io(`${apiOrigin}/events`, {
  auth: { accessToken },
});

// Dashboard: uses the existing httpOnly admin session cookie
const adminSocket = io(`${apiOrigin}/events`, {
  withCredentials: true,
});
```

The dashboard origin must be included in `CORS_ORIGINS`. Admin bearer-only
connections do not join authenticated event rooms.

| Event | Recipient | Payload |
| --- | --- | --- |
| `payment:status` | Payment owner | `transactionId`, `provider`, `status`, `amount`, `currency`, `simulated`, `bookingPaymentId` |
| `payment-claim:created` | Active admins | `claimId`, `customerId`, `amount`, `currency`, `paymentMethod`, `status` |
| `payment-claim:reviewed` | Claim owner | `claimId`, `status` (`APPROVED`/`REJECTED`), `bookingPaymentId`, `reviewNote` |

Notifications are also stored in the existing inbox, which emits
`notification:new`. Payment-specific events are emitted only after the database
transaction commits. Delivery failure does not undo an approved payment.

Simulation succeeds immediately, so its websocket event may arrive before the
HTTP response. Handle either order and avoid submitting a job twice. After
reconnection, recover state through the transaction endpoint or
`GET /payments/claims/mine`; socket events are not a durable event log.
