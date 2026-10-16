# Jobs API

All routes below are prefixed with `/api/v1`. Authenticated routes require an access token:

```http
Authorization: Bearer <access-token>
```

JSON request and response examples use UUIDs and timestamps as examples. Fields containing `null` can be populated after a technician accepts a job. Job list endpoints return all matching records as a JSON array; apply pagination in the frontend.

## Customer endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/jobs` | Create a job and optionally upload attachments |
| `GET` | `/jobs/mine` | List all jobs belonging to the current customer |
| `GET` | `/jobs/mine/:jobId` | Get one of the current customer's jobs |
| `PATCH` | `/jobs/mine/:jobId` | Edit an open, unassigned job |
| `PATCH` | `/jobs/mine/:jobId/progress` | Update customer progress on an assigned job |
| `POST` | `/jobs/mine/:jobId/retry-dispatch` | Retry matching after the offer list is exhausted |
| `DELETE` | `/jobs/mine/:jobId` | Cancel an open, unassigned job |
| `POST` | `/jobs/mine/:jobId/media` | Add attachments to an open, unassigned job |
| `DELETE` | `/jobs/mine/:jobId/media/:mediaId` | Remove an attachment from an open, unassigned job |

### Create a job

`POST /jobs` uses `multipart/form-data`, not JSON, because the request can contain file uploads. Send the following JSON-shaped values as individual text form fields, and send files under the `photos` and `video` field names:

```json
{
  "serviceCategoryId": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
  "description": "Repair a leaking kitchen tap and check the connection.",
  "locationAddress": "Kimihurura, Kigali",
  "latitude": -1.9536,
  "longitude": 30.0606,
  "offeredAmount": 25000,
  "priority": "HIGH"
}
```

Use exactly one service selection:

- For a catalog service, provide `serviceCategoryId` and omit `otherServiceName`.
- For an unavailable service, omit `serviceCategoryId` and provide its actual name in `otherServiceName` (for example, `"otherServiceName": "Solar water heater repair"`). Do not send the literal value `"Other"`.

| Field | Required | Rules |
| --- | --- | --- |
| `serviceCategoryId` | One service field required | UUID of an active catalog category |
| `otherServiceName` | One service field required | 2–80 characters |
| `description` | Yes | 10–5,000 characters |
| `locationAddress` | Yes | 3–255 characters |
| `latitude` | Yes | Number from -90 to 90 |
| `longitude` | Yes | Number from -180 to 180 |
| `offeredAmount` | Yes | Integer from 1 to 2,000,000,000, in RWF |
| `priority` | No | `LOW`, `NORMAL` (default), `HIGH`, or `URGENT` |
| `photos` | No | Up to five repeated file fields; JPEG, PNG, or WebP; 5 MiB maximum each |
| `video` | No | One MP4 file; 50 MiB and 30 seconds maximum |

The response is a job object as shown in [Job response](#job-response). A newly created job has `status: "OPEN"`, no `currentTechnician`, and `dispatchStatus` may be `PENDING` or `OFFERED` as dispatch begins.

### Read jobs

`GET /jobs/mine` returns an array of full customer job objects:

```json
[
  {
    "id": "a497ee8b-205a-4f5c-9e8a-6352f2207bd4",
    "service": "Plumbing",
    "serviceCategory": {
      "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
      "name": "Plumbing",
      "slug": "plumbing"
    },
    "otherServiceName": null,
    "description": "Repair a leaking kitchen tap and check the connection.",
    "location": {
      "address": "Kimihurura, Kigali",
      "latitude": -1.9536,
      "longitude": 30.0606
    },
    "offeredAmount": 25000,
    "currency": "RWF",
    "priority": "HIGH",
    "status": "OPEN",
    "dispatchStatus": "OFFERED",
    "customerProgress": "PENDING",
    "technicianProgress": "PENDING",
    "assignedAt": null,
    "completedAt": null,
    "createdAt": "2026-10-12T12:59:00.000Z",
    "updatedAt": "2026-10-12T12:59:00.000Z",
    "media": [],
    "currentTechnician": null,
    "customer": {
      "id": "01a37f89-3ee1-42e3-89ae-186ed15fc3a1",
      "fullName": "Sam Customer"
    },
    "assignmentHistory": []
  }
]
```

`GET /jobs/mine/:jobId` returns one job object directly.

### Edit a job

`PATCH /jobs/mine/:jobId` accepts one or more editable fields. For example:

```json
{
  "description": "Repair the leaking kitchen tap and replace the worn washer.",
  "latitude": -1.954,
  "longitude": 30.061,
  "offeredAmount": 30000
}
```

`latitude` and `longitude` must be supplied together. Use the same exactly-one service selection rule as job creation. Editing invalidates outstanding offers and starts a new matching round. The response is the updated job object.

### Update customer progress

`PATCH /jobs/mine/:jobId/progress` request:

```json
{
  "status": "IN_PROGRESS"
}
```

Allowed progress values are `STARTED`, `IN_PROGRESS`, `COMPLETED`, and `FAILED`, subject to the transition rules in [Job status](#job-status). The response is the updated job object.

### Retry dispatch or cancel a job

`POST /jobs/mine/:jobId/retry-dispatch` and `DELETE /jobs/mine/:jobId` have no request body. Both return the resulting job object. Retry is useful when `dispatchStatus` is `EXHAUSTED`; cancellation is allowed only while the job is open and unassigned.

### Add or remove attachments

`POST /jobs/mine/:jobId/media` uses `multipart/form-data` with the same `photos` and `video` file fields and file limits as job creation. At least one file must be provided. It returns the updated job object.

`DELETE /jobs/mine/:jobId/media/:mediaId` has no request body and returns the updated job object.

The limits of five photos and one video apply to all attachments on the job, not each upload request. Combined attachment size cannot exceed 75 MiB.

## Technician endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/jobs/technician/offers` | List current offers and the technician's offer history |
| `POST` | `/jobs/technician/offers/:offerId/accept` | Accept the current offer |
| `POST` | `/jobs/technician/offers/:offerId/reject` | Reject the current offer and dispatch to the next match |
| `GET` | `/jobs/technician/mine` | List all assigned and past jobs |
| `GET` | `/jobs/technician/mine/:jobId` | Get a job assigned to the current technician |
| `PATCH` | `/jobs/technician/mine/:jobId/progress` | Update technician progress |
| `POST` | `/jobs/technician/mine/:jobId/drop` | Drop an assigned job with a reason |

### List and respond to offers

`GET /jobs/technician/offers` returns an array:

```json
[
  {
    "id": "f0ab9447-04fb-40f6-86aa-e714de851825",
    "status": "OFFERED",
    "round": 1,
    "matchScore": 94,
    "distanceMeters": 1200,
    "offeredAt": "2026-10-12T13:00:00.000Z",
    "expiresAt": "2026-10-12T13:05:00.000Z",
    "respondedAt": null,
    "rejectionReason": null,
    "dropReason": null,
    "job": {
      "id": "a497ee8b-205a-4f5c-9e8a-6352f2207bd4",
      "service": "Plumbing",
      "description": "Repair a leaking kitchen tap and check the connection.",
      "locationAddress": "Kimihurura, Kigali",
      "latitude": -1.9536,
      "longitude": 30.0606,
      "offeredAmount": 25000,
      "currency": "RWF",
      "priority": "HIGH",
      "status": "OPEN",
      "createdAt": "2026-10-12T12:59:00.000Z",
      "media": []
    }
  }
]
```

An active offer (`status: "OFFERED"`) can include its media. Historical offers include `REJECTED`, `EXPIRED`, `ACCEPTED`, or `DROPPED` status; their `job.media` is empty.

`POST /jobs/technician/offers/:offerId/accept` has no request body and returns the assigned job object using the technician's [job response](#job-response) shape.

`POST /jobs/technician/offers/:offerId/reject` accepts an optional reason:

```json
{
  "reason": "I am unavailable at that time."
}
```

Successful response:

```json
{
  "message": "Job offer rejected."
}
```

### Read assigned jobs

`GET /jobs/technician/mine` returns a JSON array of technician job response objects. `GET /jobs/technician/mine/:jobId` returns one job object directly. Technicians only see jobs assigned to them and offers sent to them; there is no public feed of untaken jobs.

### Update progress or drop a job

`PATCH /jobs/technician/mine/:jobId/progress` accepts:

```json
{
  "status": "COMPLETED"
}
```

Allowed progress values and transitions are described in [Job status](#job-status). The response is the updated job object.

`POST /jobs/technician/mine/:jobId/drop` requires a reason:

```json
{
  "reason": "My vehicle broke down and I cannot reach the location."
}
```

Successful response:

```json
{
  "message": "Job dropped and offered to the next eligible technician."
}
```

## Admin endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/admin/jobs` | List all jobs with matching offers and assignment history |
| `GET` | `/admin/jobs/summary` | Dashboard job counts (active, completed, open disputes) |
| `GET` | `/admin/jobs/:jobId` | Get full details for a job |

`GET /admin/jobs` returns a JSON array of admin job objects. `GET /admin/jobs/:jobId` returns one admin job object directly. Admin responses include `customer`, `assignmentHistory`, and `offers`, in addition to the common job fields.

Example admin response:

```json
{
  "id": "a497ee8b-205a-4f5c-9e8a-6352f2207bd4",
  "service": "Plumbing",
  "serviceCategory": {
    "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
    "name": "Plumbing",
    "slug": "plumbing"
  },
  "otherServiceName": null,
  "description": "Repair a leaking kitchen tap and check the connection.",
  "location": {
    "address": "Kimihurura, Kigali",
    "latitude": -1.9536,
    "longitude": 30.0606
  },
  "offeredAmount": 25000,
  "currency": "RWF",
  "priority": "HIGH",
  "status": "ASSIGNED",
  "dispatchStatus": "STOPPED",
  "customerProgress": "PENDING",
  "technicianProgress": "STARTED",
  "assignedAt": "2026-10-12T13:00:00.000Z",
  "completedAt": null,
  "createdAt": "2026-10-12T12:59:00.000Z",
  "updatedAt": "2026-10-12T13:00:00.000Z",
  "media": [],
  "currentTechnician": {
    "id": "8a6541c3-1958-48e7-96c4-0e465a3e57e7",
    "fullName": "Alex Technician",
    "profile": {
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
      "publicLocationLabel": "Kigali",
      "profilePictureUrl": null
    }
  },
  "customer": {
    "id": "01a37f89-3ee1-42e3-89ae-186ed15fc3a1",
    "fullName": "Sam Customer",
    "phoneNumber": "+250790000000",
    "email": "sam@example.test"
  },
  "assignmentHistory": [
    {
      "technicianId": "8a6541c3-1958-48e7-96c4-0e465a3e57e7",
      "technicianName": "Alex Technician",
      "acceptedAt": "2026-10-12T13:00:00.000Z",
      "endedAt": null,
      "endReason": null,
      "reason": null
    }
  ],
  "offers": [
    {
      "id": "f0ab9447-04fb-40f6-86aa-e714de851825",
      "technicianId": "8a6541c3-1958-48e7-96c4-0e465a3e57e7",
      "technicianName": "Alex Technician",
      "round": 1,
      "matchScore": 94,
      "distanceMeters": 1200,
      "status": "ACCEPTED",
      "offeredAt": "2026-10-12T12:59:30.000Z",
      "expiresAt": "2026-10-12T13:04:30.000Z",
      "respondedAt": "2026-10-12T13:00:00.000Z",
      "rejectionReason": null,
      "dropReason": null
    }
  ]
}
```

Admin listing returns every job without backend pagination; apply UI pagination and filters on the frontend. Admin approval and mutation routes are not part of this feature.

### Dashboard summary

`GET /admin/jobs/summary` returns the counts the admin dashboard shows. It takes no query parameters.

```json
{
  "active": 23,
  "completed": 417,
  "openDisputes": null
}
```

`active` counts jobs that are still in flight (`OPEN` or `ASSIGNED`). `completed` counts jobs with `status: "COMPLETED"`. `FAILED` and `CANCELLED` jobs are terminal and are included in neither. Disputes are not modelled yet, so `openDisputes` is `null`; the dashboard renders a placeholder for a `null` figure instead of a wrong number.

## Job response

Customer job reads and mutations return this object directly. Technician responses use the same common fields but omit `customer` and `assignmentHistory`. If a technician has accepted the job, `currentTechnician` contains their public professional profile for every viewer. It excludes private contact details, exact home address and coordinates, national ID, and payment information. Admin responses also include the offer details shown above.

```json
{
  "id": "a497ee8b-205a-4f5c-9e8a-6352f2207bd4",
  "service": "Plumbing",
  "serviceCategory": {
    "id": "b1785204-f59a-4cc3-a9f9-94932e4a6d30",
    "name": "Plumbing",
    "slug": "plumbing"
  },
  "otherServiceName": null,
  "description": "Repair a leaking kitchen tap and check the connection.",
  "location": {
    "address": "Kimihurura, Kigali",
    "latitude": -1.9536,
    "longitude": 30.0606
  },
  "offeredAmount": 25000,
  "currency": "RWF",
  "priority": "HIGH",
  "status": "OPEN",
  "dispatchStatus": "OFFERED",
  "customerProgress": "PENDING",
  "technicianProgress": "PENDING",
  "assignedAt": null,
  "completedAt": null,
  "createdAt": "2026-10-12T12:59:00.000Z",
  "updatedAt": "2026-10-12T12:59:00.000Z",
  "media": [
    {
      "id": "26500c63-7ba1-4b7b-b72f-1c8795c228a5",
      "type": "PHOTO",
      "mimeType": "image/jpeg",
      "fileName": "leaking-tap.jpg",
      "sizeBytes": 145000,
      "durationSeconds": null,
      "createdAt": "2026-10-12T12:59:00.000Z",
      "downloadPath": "/api/v1/jobs/a497ee8b-205a-4f5c-9e8a-6352f2207bd4/media/26500c63-7ba1-4b7b-b72f-1c8795c228a5"
    }
  ],
  "currentTechnician": null,
  "customer": {
    "id": "01a37f89-3ee1-42e3-89ae-186ed15fc3a1",
    "fullName": "Sam Customer"
  },
  "assignmentHistory": []
}
```

## Shared media download

`GET /jobs/:jobId/media/:mediaId` returns the file bytes, not JSON. A job's `media[].downloadPath` contains the URL path. Include the access token when requesting it. Access is limited to the job owner, the technician with the current offer or assignment, and admins. Responses set `X-Content-Type-Options: nosniff`.

## Matching and dispatch

Only active technicians with approved profiles, online availability, a matching service, and a location within 50 km are considered. Service matches are exact by catalog category, or by normalized service/category name for an “Other” request. The score awards 60 points for the service match and up to 40 points for proximity, decreasing linearly to zero at 50 km. Scores below 50 are excluded. Eligible technicians are offered the job sequentially from highest score to lowest, with distance as the tie-breaker. Priority is shown but does not affect ranking.

Only one offer is active at a time. The technician has five minutes to accept or reject; a rejection or timeout advances to the next eligible technician. `dispatchStatus` is `PENDING` while dispatch is being scheduled, `OFFERED` while one technician has the offer, `EXHAUSTED` when there are no remaining candidates, and `STOPPED` after assignment or closure. The customer can retry an exhausted dispatch or edit the open job to start a new matching round.

If dispatch scheduling fails after a job is saved, the API returns `503` and includes the job ID in its error message. Do not create a duplicate; retry using `POST /jobs/mine/:jobId/retry-dispatch` after Redis is healthy.

Connected technicians may also receive a `job:offer` event on the `/events` Socket.IO namespace. Authenticate with `auth: { "accessToken": "<access-token>" }` or an `Authorization: Bearer` handshake header. REST is the source of truth; after reconnecting, fetch `/jobs/technician/offers`.

## Job status

Overall job `status` is `OPEN` before assignment, `ASSIGNED` while in progress, `COMPLETED` when both parties mark their progress completed, and `FAILED` if either party marks it failed. Customers can cancel only an open, unassigned job.

Customer and technician progress are tracked independently. Accepting an offer sets technician progress to `STARTED`. Allowed transitions for either side:

- `PENDING` → `STARTED` or `FAILED`
- `STARTED` → `IN_PROGRESS`, `COMPLETED`, or `FAILED`
- `IN_PROGRESS` → `COMPLETED` or `FAILED`
- `COMPLETED` and `FAILED` are terminal

A technician can drop an assigned job at any point by providing a reason. The job becomes open again, its progress resets to `PENDING`, and dispatch resumes for the next eligible technician. Assignment history retains the prior technician and drop reason.
