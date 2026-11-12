# Paid Job Booking API

All routes below are prefixed with `/api/v1`. Job-owner routes accept a
customer or technician bearer token; administrator routes require an
administrator session or token. JSON endpoints use
`Content-Type: application/json`. Job creation and media uploads use
`multipart/form-data`.

For a normal request, a logged-in customer or technician previews eligible
technicians, pays the normal category booking fee, creates the job, then
proposes one matching technician. A customer verifies their account phone
before their first job; later jobs use the saved verification and need no new
OTP. Technicians continue to verify for each job. For an
SOS request, the owner pays the higher SOS fee and creates the request through
the SOS endpoint; the system automatically offers it to eligible technicians
in match order, one at a time, with 30 seconds to respond to each offer.

## Booking flow

1. List service categories with `GET /catalog/categories`; select a category
   with a configured positive `visitFee` and, for SOS requests, a higher
   `sosBookingFee`.
2. Preview matches using `GET /jobs/matching-technicians`.
3. Pay the booking fee using `POST /payments/mock`. This development-only
   payment is not a real money transfer.
4. If the customer has not verified their account phone, or the job owner is a
   technician, request and verify the phone OTP using
   `POST /jobs/phone-verification/request` and
   `POST /jobs/phone-verification/verify`. The verified customer number becomes
   the account's phone login number. Customers may verify another number later
   to replace it, provided no other account owns that number.
5. Create the job using the returned `paymentId` and, when required, the
   `verificationId`.
6. Propose a technician from the preview list using
   `POST /jobs/mine/:jobId/requests`.

See [Booking Payments API](booking-payments.md) for payment records, validity,
and administrator extensions.

## Customer and technician job-owner endpoints

| Method   | URL                                                  | Purpose                                                                       |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST`   | `/api/v1/jobs/phone-verification/request`            | Customer or technician: send a phone OTP for this job request                 |
| `POST`   | `/api/v1/jobs/phone-verification/verify`             | Verify that OTP                                                               |
| `GET`    | `/api/v1/jobs/matching-technicians?...`              | Preview scored matches before paying                                          |
| `POST`   | `/api/v1/jobs/matching-technicians/geocode`          | Geocode one or more named places and preview nearby technicians               |
| `POST`   | `/api/v1/jobs/matching-technicians/by-location-name` | Match technician location labels against place-name text                      |
| `POST`   | `/api/v1/jobs`                                       | Customer or technician: create a paid job request and optionally upload media |
| `POST`   | `/api/v1/jobs/sos`                                   | Customer or technician: create an SOS job and automatically dispatch offers   |
| `GET`    | `/api/v1/jobs/mine`                                  | List this user's visible jobs                                                 |
| `GET`    | `/api/v1/jobs/mine/:jobId`                           | Read one owned job                                                            |
| `POST`   | `/api/v1/jobs/mine/:jobId/requests`                  | Propose a matching technician                                                 |
| `POST`   | `/api/v1/jobs/mine/:jobId/confirm-cooperation`       | Customer confirms agreement with the assigned technician                      |
| `PATCH`  | `/api/v1/jobs/mine/:jobId`                           | Edit an open, unassigned job                                                  |
| `PATCH`  | `/api/v1/jobs/mine/:jobId/progress`                  | Update customer progress                                                      |
| `POST`   | `/api/v1/jobs/mine/:jobId/cancel`                    | Cancel with a reason                                                          |
| `POST`   | `/api/v1/jobs/mine/:jobId/pause`                     | Request a mutual pause                                                        |
| `POST`   | `/api/v1/jobs/mine/:jobId/resume`                    | Request a mutual resume                                                       |
| `DELETE` | `/api/v1/jobs/mine/:jobId`                           | Hide a completed/cancelled job from the job owner's history                   |
| `POST`   | `/api/v1/jobs/mine/:jobId/retry-dispatch`            | Retry a pending dispatch after a scheduling issue                             |
| `POST`   | `/api/v1/jobs/mine/:jobId/media`                     | Add media to an editable job                                                  |
| `DELETE` | `/api/v1/jobs/mine/:jobId/media/:mediaId`            | Remove media from an editable job                                             |

### Verify an account phone before creating a job

**POST** `/api/v1/jobs/phone-verification/request` — customer or technician
bearer token. Customers may omit the body to verify the current account phone,
or submit a different number to verify and replace it. Technicians may only
verify their current number and still need a new verification for each job.

```json
{
  "phoneNumber": "+250788123456"
}
```

For customers whose current number is already verified, omitting the number
returns `verified: true` without sending an OTP. A different number always
requires verification, and the number cannot belong to another account. In
development, read the code from the API terminal when `SMS_MODE=console` is
configured. A pending verification response includes a `verificationId`.

```json
{
  "verificationId": "8ae5cc0d-578a-4f4f-870d-700c4fb4b108",
  "expiresAt": "2026-10-28T12:05:00.000Z",
  "message": "OTP sent. It expires in 5 minutes."
}
```

**POST** `/api/v1/jobs/phone-verification/verify`:

```json
{
  "verificationId": "8ae5cc0d-578a-4f4f-870d-700c4fb4b108",
  "otp": "123456"
}
```

After a successful OTP, the response includes `phoneNumber` and `verifiedAt`.
For customers, the verified number is saved as the account's phone number and
future jobs do not need a `phoneVerificationId`. For a technician, the
one-use `verificationId` must still be passed to that job.

### Preview scored technicians

**GET**
`/api/v1/jobs/matching-technicians?serviceCategoryId={{categoryId}}&latitude=-1.9536&longitude=30.0606`
— customer or technician bearer token; no body.

For an unlisted service, replace `serviceCategoryId` with
`otherServiceName=Solar%20panel%20installation`. Supply exactly one service
selector. This endpoint returns eligible technicians and their match scores;
it does not require payment and does not send an offer.

Example response:

```json
[
  {
    "technicianId": "8a6541c3-1958-48e7-96c4-0e465a3e57e7",
    "fullName": "Alex Technician",
    "matchAccuracy": 94,
    "distanceMeters": 1200,
    "gender": "MALE",
    "yearsOfExperience": 8,
    "serviceExperiences": [
      {
        "categoryId": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
        "category": {
          "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
          "name": "Plumbing",
          "slug": "plumbing"
        },
        "customName": null,
        "yearsOfExperience": 8
      }
    ],
    "publicLocationLabel": "Kigali"
  }
]
```

### Match by named locations

Both named-location endpoints accept a customer or technician bearer token
and accept one to five locations:

```json
{
  "serviceCategoryId": "{{categoryId}}",
  "locations": ["Kimihurura, Kigali", "Kicukiro, Kigali"],
  "latitude": null,
  "longitude": null
}
```

Use numeric `latitude` and `longitude` together to add geospatial matches;
both may be `null` or omitted for text-only matching.

**POST** `/api/v1/jobs/matching-technicians/geocode` geocodes each place
(OpenStreetMap Nominatim by default) and runs the normal distance/rating-aware
match for each resulting coordinate. A technician matching more than one
requested place appears once; `matchedLocations` lists the matching queries,
and their score/distance come from their strongest match.

**POST** `/api/v1/jobs/matching-technicians/by-location-name` does not call an
external provider. It case-insensitively searches each technician's stored
base address and public location label for any supplied place name. It sorts
eligible text matches using the existing rejection/cancellation penalties.
This works for technicians with text-only profiles and does not require their
coordinates. The same request may include an optional `latitude` and
`longitude` pair; geographic candidates are then included and merged with the
text matches. Results include `distanceMeters` where coordinates matched and
`matchedLocations` for matching text. At least one of `locations` or a
coordinate pair is required, and coordinates must be sent together.

The geocoding endpoint and User-Agent are configurable using
`GEOCODING_ENDPOINT` and `GEOCODING_USER_AGENT`. The default Nominatim service
has a public usage policy and is rate-limited by this API process; configure an
appropriate provider for production traffic. Both endpoints are previews only
and do not create a job request or send an offer.

### Create a job

**POST** `/api/v1/jobs` — customer or technician bearer token. Use **Body → form-data**
because photos and video are supported. Add the values below as text fields;
the JSON is a shape reference, not a raw JSON body:

```json
{
  "paymentId": "a44a6586-6681-46ae-9c4a-86b4a83ae218",
  "phoneVerificationId": "8ae5cc0d-578a-4f4f-870d-700c4fb4b108",
  "serviceCategoryId": "{{categoryId}}",
  "requestType": "NORMAL",
  "description": "Repair a leaking kitchen tap and check the connection.",
  "locationAddress": "Kimihurura, Kigali",
  "latitude": -1.9536,
  "longitude": 30.0606,
  "offeredAmount": 25000,
  "priority": "HIGH"
}
```

Required form fields: `paymentId`, exactly one of `serviceCategoryId` or
`otherServiceName`, `description`, `locationAddress`, `latitude`, `longitude`,
and `offeredAmount`. Include `phoneVerificationId` only when required by the
account's verification state (always for technicians; for customers, until
their account phone is verified). A payment must belong to this customer, be
unused, be valid, and match the selected category and `requestType` (`NORMAL`
by default). Custom
`otherServiceName` requests can be previewed but cannot currently be booked:
the payment workflow requires a `serviceCategoryId`. Choose a configured category to create a paid request. A one-use phone
verification is consumed when supplied.

Optional files: up to five `photos` (JPEG, PNG, or WebP; 5 MiB each) and one
`video` (MP4; up to 50 MiB and 30 seconds). Use repeated `photos` fields for
multiple images. For jobs without attachments, the request may use JSON.

### Create an SOS job

**POST** `/api/v1/jobs/sos` — customer or technician bearer token; use
**Body → form-data**. First create an SOS payment (`requestType: "SOS"`). If
required by the account's verification state, verify the job owner's phone.
Submit the same fields as job creation:
`paymentId`, `serviceCategoryId`, `description`,
`locationAddress`, `latitude`, `longitude`, and `offeredAmount`. Optional
`priority`, `photos`, and `video` are supported. This route sets the job type
to `SOS` and automatically sends an offer to the highest-ranked matching
approved, online technician.

Each offer remains open for 30 seconds. Rejection or timeout sends the SOS
request to the next matching technician who has not already received an offer.
If the queue is exhausted, the job is left open and can be retried or manually
proposed to any eligible match using `POST /api/v1/jobs/mine/{{jobId}}/requests`.
That manual proposal can intentionally include a technician who already
received or released the SOS request.

If a technician accepts but releases an SOS job before both parties confirm
cooperation, the payment's remaining validity resumes and the job returns to
the queue. The releasing technician is skipped for automatic redispatch. If
both parties have confirmed cooperation, a later release follows the normal
admin-reviewed cancellation path and does not restart the queue.
If the customer cancels an assigned SOS job before confirming cooperation, the
assignment is released and automatic dispatch continues with the next eligible
technician, provided the payment remains valid.

### Propose a technician

**POST** `/api/v1/jobs/mine/{{jobId}}/requests` — job-owner bearer token:

```json
{
  "technicianId": "{{technicianId}}"
}
```

Choose a technician returned by the matching preview. Only one proposal can be
active at a time. A rejection or five-minute timeout leaves the job open so
the customer can propose another matching technician, provided the payment is
still valid.

### Read, edit, and cancel a job

`GET /api/v1/jobs/mine` returns the signed-in user's jobs except those they hid.
`GET /api/v1/jobs/mine/{{jobId}}` returns one visible job.

`PATCH /api/v1/jobs/mine/{{jobId}}` edits an open, unassigned request. Example:

```json
{
  "description": "Repair the leaking kitchen tap and replace the worn washer.",
  "locationAddress": "Kacyiru, Kigali",
  "latitude": -1.954,
  "longitude": 30.061,
  "offeredAmount": 30000
}
```

Latitude and longitude must be provided together. The category cannot be
changed after the payment is attached; cancel and create a new paid request
instead.

**POST** `/api/v1/jobs/mine/{{jobId}}/cancel` immediately cancels an open job
or releases an assigned technician and returns the job to `OPEN`:

```json
{
  "reason": "I need to change the requested service."
}
```

Customer cancellation of an assigned job is immediate; the attached payment's
remaining validity resumes for reassignment. Only completed or cancelled jobs
can be hidden with `DELETE /api/v1/jobs/mine/{{jobId}}`. Hiding is per user and
does not delete the other party's history.

### Progress, pause, and resume

After an offer is accepted, the job is `ASSIGNED` and the booking payment is
`PAUSED`. The customer and assigned technician independently confirm their
agreement while the job is `ASSIGNED` or `PAUSED`, using:

- Customer: `POST /api/v1/jobs/mine/{{jobId}}/confirm-cooperation`
- Technician: `POST /api/v1/jobs/technician/mine/{{jobId}}/confirm-cooperation`

The job response includes `cooperationStatus` (`PENDING` until both confirm,
then `CONFIRMED`) and both confirmation timestamps. When the second party
confirms, the payment immediately becomes `EXPIRED` and `validUntil` is set to
that time, regardless of the remaining booking lifetime. The job remains
in its current work status (`ASSIGNED` or `PAUSED`); cooperation confirmation
is separate from work progress and completion, which still requires both sides
to mark their work completed.

If an assigned job is cancelled before mutual confirmation, the existing
remaining payment validity resumes and the job can be reassigned. After mutual
confirmation, cancellation ends the job rather than reopening it for
reassignment, because its booking payment has expired.

Both job participants update their own progress with
`PATCH /api/v1/jobs/mine/{{jobId}}/progress` (customer) or
`PATCH /api/v1/jobs/technician/mine/{{jobId}}/progress` (technician):

```json
{
  "status": "IN_PROGRESS"
}
```

Progress values are `STARTED`, `IN_PROGRESS`, `COMPLETED`, and `FAILED`.
Overall job status becomes `COMPLETED` only when both sides mark it completed;
either side marking it failed makes the job `FAILED`.

Pause and resume are mutual actions. Both participants call the corresponding
endpoint for the same job; the state changes only after both requests:

- Customer: `POST /api/v1/jobs/mine/{{jobId}}/pause` or `/resume`
- Technician: `POST /api/v1/jobs/technician/mine/{{jobId}}/pause` or `/resume`

These requests have no body. A mutually paused job has `status: "PAUSED"` and
releases the technician to accept another job. Mutual resume sets the job back
to `ASSIGNED` and the technician offline; the technician cannot resume if
another assigned job is still active.

## Technician endpoints

| Method   | URL                                                       | Purpose                                                |
| -------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `GET`    | `/api/v1/jobs/technician/offers`                          | List current and past offers                           |
| `POST`   | `/api/v1/jobs/technician/offers/:offerId/accept`          | Accept an offer                                        |
| `POST`   | `/api/v1/jobs/technician/offers/:offerId/reject`          | Reject an offer                                        |
| `GET`    | `/api/v1/jobs/technician/mine`                            | List visible current and past jobs                     |
| `GET`    | `/api/v1/jobs/technician/mine/:jobId`                     | Read an assigned or previously assigned job            |
| `POST`   | `/api/v1/jobs/technician/mine/:jobId/confirm-cooperation` | Technician confirms agreement with the job owner       |
| `PATCH`  | `/api/v1/jobs/technician/mine/:jobId/progress`            | Update technician progress                             |
| `POST`   | `/api/v1/jobs/technician/mine/:jobId/drop`                | Request cancellation with a reason                     |
| `POST`   | `/api/v1/jobs/technician/mine/:jobId/pause`               | Request a mutual pause                                 |
| `POST`   | `/api/v1/jobs/technician/mine/:jobId/resume`              | Request a mutual resume                                |
| `DELETE` | `/api/v1/jobs/technician/mine/:jobId`                     | Hide a completed/cancelled job from technician history |

Reject an offer with an optional reason:

```json
{
  "reason": "I am unavailable at that time."
}
```

Rejecting or cancelling jobs lowers future match scores by five points per
event, capped at a 40-point penalty. Rejecting is immediate. Dropping an
accepted job requires a reason and remains assigned until an administrator
approves the cancellation request.

A technician cannot accept another job while a job is `ASSIGNED`. A mutually
`PAUSED` job does not block accepting another job. Only `COMPLETED` or
`CANCELLED` jobs can be hidden from the technician's history.

## Administrator endpoints

| Method   | URL                                                   | Purpose                                          |
| -------- | ----------------------------------------------------- | ------------------------------------------------ |
| `GET`    | `/api/v1/admin/jobs`                                  | List all jobs, offers, and assignment history    |
| `GET`    | `/api/v1/admin/jobs/summary`                          | Dashboard job counts                             |
| `GET`    | `/api/v1/admin/jobs/pipeline`                         | Ten dashboard pipeline stage counts              |
| `GET`    | `/api/v1/admin/jobs/pipeline/:stage`                  | One page of jobs at a pipeline stage             |
| `POST`   | `/api/v1/admin/jobs`                                  | Create and dispatch a job on a customer's behalf |
| `GET`    | `/api/v1/admin/jobs/cancellation-requests`            | List technician cancellation requests            |
| `PATCH`  | `/api/v1/admin/jobs/cancellation-requests/:requestId` | Approve or reject a technician cancellation      |
| `GET`    | `/api/v1/admin/jobs/:jobId`                           | Get a job                                        |
| `PATCH`  | `/api/v1/admin/jobs/:jobId`                           | Edit job fields; open jobs are re-matched        |
| `POST`   | `/api/v1/admin/jobs/:jobId/cancel`                    | Cancel an open or assigned job                   |
| `POST`   | `/api/v1/admin/jobs/:jobId/reassign`                  | Reassign an open or assigned job                 |
| `DELETE` | `/api/v1/admin/jobs/:jobId`                           | Permanently delete a completed/cancelled job     |

Review a technician cancellation:

```json
{
  "decision": "APPROVE",
  "reviewNote": "Cancellation approved."
}
```

`decision` is `APPROVE` or `REJECT`. Approval releases the technician and
resumes the payment's remaining validity; rejection leaves the assignment in
place. Admins can permanently delete only completed or cancelled jobs.
Payment records and audit history are retained. User-level `DELETE` endpoints
only hide jobs and never permanently delete them.

## Disputes

Either the customer who owns a job or its currently assigned technician can open one dispute after a technician has been assigned. The reason must be 10–2,000 characters. A second dispute for the same job returns `409 Conflict`.

| Method | Path                             | Purpose                                                         |
| ------ | -------------------------------- | --------------------------------------------------------------- |
| `POST` | `/jobs/:jobId/disputes`          | Customer or assigned technician opens a dispute                 |
| `GET`  | `/admin/disputes`                | List open disputes; use `?state=resolved` for resolved disputes |
| `GET`  | `/admin/disputes/:jobId`         | Read the disputed job and its conversation                      |
| `POST` | `/admin/disputes/:jobId/resolve` | Record the admin decision                                       |

Open a dispute with:

```json
{
  "reason": "The work was marked complete, but the leak is still present."
}
```

The create endpoint returns the caller's normal job response, including the dispute reason, opener, and opening time. Admin resolution requires `outcome` (`CUSTOMER`, `TECHNICIAN`, or `PARTIAL`), `amount` in RWF, and a 2–2,000 character `note`. Resolution is immutable and does not itself process or transfer money.

`GET /admin/jobs` returns a JSON array of admin job objects. `GET /admin/jobs/:jobId` returns one admin job object directly. Admin responses include `customer`, `assignmentHistory`, and `offers`, in addition to the common job fields.

Example admin response:

```json
{
  "active": 23,
  "completed": 417,
  "openDisputes": 2
}
```

`active` counts `OPEN`, `ASSIGNED`, and `PAUSED` jobs. `completed` counts jobs
with `status: "COMPLETED"`. `FAILED` and `CANCELLED` jobs are terminal and
excluded. `openDisputes` counts dispute records without an admin resolution.

## Job pipeline

`GET /api/v1/admin/jobs/pipeline` returns the ten stages the dashboard shows, in
lifecycle order. Each stage reports `key`, `label`, `tracked`, `count`, and a
`description` of how the count is derived. The response also carries
`generatedAt`.

Only stages backed by stored job state are counted. Because the API has no
diagnosis, quote, or quote-approval records, those three stages return
`tracked: false` and `count: null`; the endpoint never invents a zero.

| Stage    | Derivation                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Request  | `status: OPEN` and `dispatchStatus: PENDING`                                                                              |
| Match    | `status: OPEN` and `dispatchStatus` is `OFFERED`, `EXHAUSTED`, or `STOPPED`                                               |
| Accept   | `status` is `ASSIGNED`/`PAUSED`, a technician is assigned, and `cooperationStatus: PENDING`                              |
| Visit    | `status` is `ASSIGNED`/`PAUSED`, `cooperationStatus: CONFIRMED`, and neither side's progress is `IN_PROGRESS`/`COMPLETED` |
| Diagnose | Not tracked                                                                                                               |
| Quote    | Not tracked                                                                                                               |
| Approve  | Not tracked                                                                                                               |
| Repair   | `status` is `ASSIGNED`/`PAUSED`, `cooperationStatus: CONFIRMED`, and either side's progress is `IN_PROGRESS`/`COMPLETED`  |
| Settle   | `status: COMPLETED` and `ratedAt` is null                                                                                 |
| Rate     | `status: COMPLETED` and `ratedAt` is set                                                                                  |

Cancelled and failed jobs are terminal and appear in no in-flight stage, so the
tracked counts are indicators rather than a partition of every job.

```json
{
  "stages": [
    {
      "key": "request",
      "label": "Request",
      "count": 4,
      "tracked": true,
      "description": "Open jobs still waiting for dispatch to start."
    },
    {
      "key": "diagnose",
      "label": "Diagnose",
      "count": null,
      "tracked": false,
      "description": "Not tracked: the backend does not record diagnosis separately from work progress."
    }
  ],
  "generatedAt": "2026-11-09T09:00:00.000Z"
}
```

`GET /api/v1/admin/jobs/pipeline/:stage` returns one page of the same admin job
objects as `GET /api/v1/admin/jobs/:jobId`, wrapped in
`{ stage, data, pagination }`. `stage` repeats the stage summary with `count`
equal to the page total. Untracked stages return an empty page with `total: 0`
rather than an error. Paging uses `page` (default 1) and `limit` (default 20,
maximum 100).

```json
{
  "stage": {
    "key": "visit",
    "label": "Visit",
    "count": 8,
    "tracked": true,
    "description": "Cooperation is confirmed and neither side has started the work yet."
  },
  "data": [{ "id": "…", "status": "ASSIGNED" }],
  "pagination": { "page": 1, "limit": 20, "total": 8, "totalPages": 1 }
}
```

## Job and payment status

Job statuses are `OPEN`, `ASSIGNED`, `PAUSED`, `COMPLETED`, `FAILED`, and
`CANCELLED`. The match preview considers active, approved, online technicians
with the matching service within 50 km. A base score uses service fit and
distance; technician rejection/cancellation penalties are applied and scores
below the minimum are excluded. The response includes match scores so the
customer can select a technician.

The category booking fee starts with seven days of validity. The countdown
pauses when a technician accepts the job and resumes after an approved
technician cancellation or customer cancellation if cooperation has not been
confirmed. Both participants confirming cooperation expires the payment
immediately. A payment remains paused while an assigned job is paused before
mutual confirmation, and is marked completed when both sides complete the job.

An expired payment does not automatically delete or cancel the job. The
customer must make another payment and create a new job request. Administrators
can extend a payment by 1–30 days; see [Booking Payments API](booking-payments.md).

## Shared job media download

`GET /api/v1/jobs/:jobId/media/:mediaId` returns file bytes, not JSON.
Authenticated access is limited to the job owner, a technician with an offer
or assignment, and administrators.
