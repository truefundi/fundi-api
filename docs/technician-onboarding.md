# Technician Onboarding API

This document covers technician profile management: creating and updating a
profile, going online, discovery, and administrator oversight. Document
uploads and profile pictures are covered in
[`technician-documents.md`](./technician-documents.md).

Three concepts are kept deliberately separate:

- **`user.status`** — whether the account can authenticate at all (`ACTIVE`, `INACTIVE`).
- **`verificationStatus`** — the administrator's approval state (`PENDING`, `APPROVED`, `REJECTED`).
- **`availabilityStatus`** — whether the technician is taking work (`ONLINE`, `OFFLINE`).

A technician must be **active**, **approved**, and **online** to appear in
discovery listings.

## Authentication

Every route below requires a Bearer access token unless marked **Public**.

| Role required | Routes |
| --- | --- |
| `TECHNICIAN` | `/api/v1/technicians/profile*`, `/api/v1/technicians/availability` |
| Any signed-in role (`CUSTOMER`, `TECHNICIAN`, `ADMIN`) | `/api/v1/technicians`, `/api/v1/technicians/approved`, `/api/v1/technicians/available/:id`, `/api/v1/technicians/approved/:id` |
| **Public** (no auth) | `/api/v1/public/technicians*` |
| `ADMIN` | `/api/v1/admin/technicians*` |

Send `Content-Type: application/json` on every non-multipart request.

## Field visibility

Every technician object returned by the API has the **same key set**, but
some values are redacted depending on who is asking.

| Field | Owner / Admin | Signed-in non-owner | Anonymous |
| --- | --- | --- | --- |
| `nationalIdNumber` | ✅ value | `null` | `null` |
| `paymentMethod` | ✅ value | `null` | `null` |
| `paymentNumber` | ✅ value | `null` | `null` |
| `user.phoneNumber` | ✅ value | ✅ value | `null` |
| `user.email` | ✅ value | ✅ value | `null` |
| `user.status` | ✅ value | ✅ value | `null` |
| `user.createdAt` / `user.updatedAt` | ✅ value | ✅ value | `null` |
| `profilePictureUrl`, `location`, `serviceExperiences`, `yearsOfExperience`, `verificationStatus`, `availabilityStatus` | ✅ value | ✅ value | ✅ value |

`yearsOfExperience` is **derived**: it is the maximum years-of-experience
across all of the technician's service entries, or `0` when there are none.

## Service experiences

A technician advertises their work through a list of **service experiences**.
Each entry is either:

- a real service category, referenced by `categoryId`, **or**
- a custom service name (`customName`) for work that is not yet in the catalogue.

Each entry also carries its own `yearsOfExperience`.

Rules enforced by the API:

- At most **10** entries.
- Each entry has **either** `categoryId` **or** `customName` — never both, never neither.
- A real `categoryId` must reference an **active** category.
- No duplicate `categoryId` and no duplicate `customName` (case-insensitive) within one technician.
- Sending `serviceExperiences` **replaces** the technician's whole list atomically.

## Technician self-service

### `POST /api/v1/technicians/profile`

Registers the signed-in technician's profile for the first time.

Auth: **`TECHNICIAN`**.

The following fields are **required** and their absence produces a single
`400` listing every missing field:

- `gender`
- `nationalIdNumber`
- `baseAddress`
- `baseLatitude` and `baseLongitude` (as a pair)
- `paymentMethod`
- `paymentNumber`
- `serviceExperiences` (non-empty)

Optional at registration: `publicLocationLabel`, `fullName`, `phoneNumber`,
`email`. The user-account fields default to the ones already on the signed-in
`User` row.

Profile picture upload is a **separate** call — see
[`technician-documents.md`](./technician-documents.md).

**Request**

```json
{
  "fullName": "Amina Example",
  "phoneNumber": "+250788123456",
  "email": "amina@example.com",
  "gender": "FEMALE",
  "nationalIdNumber": "ID123456",
  "baseAddress": "Kigali, Rwanda",
  "publicLocationLabel": "Kigali, Rwanda",
  "baseLatitude": -1.95,
  "baseLongitude": 30.06,
  "paymentMethod": "MOMO",
  "paymentNumber": "+250788123456",
  "serviceExperiences": [
    { "categoryId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100", "yearsOfExperience": 5 },
    { "customName": "Solar panel install", "yearsOfExperience": 2 }
  ]
}
```

**Response `201`**

A full technician object with `verificationStatus: "PENDING"` and
`availabilityStatus: "OFFLINE"`.

**Errors**

| Status | When |
| --- | --- |
| `400` | One or more required fields missing — message lists them |
| `400` | `baseLatitude`/`baseLongitude` provided individually |
| `400` | A `serviceExperiences` entry has both or neither of `categoryId` / `customName` |
| `400` | More than 10 entries, or duplicate categories/custom names |
| `400` | A `categoryId` references an unknown or inactive category |
| `401` | Missing or invalid token |
| `403` | Caller is not a `TECHNICIAN` |
| `409` | A profile already exists for this user — use `PUT` |
| `409` | `phoneNumber`, `email`, or `nationalIdNumber` already used |

### `GET /api/v1/technicians/profile`

Returns the signed-in technician's profile.

Auth: **`TECHNICIAN`**.

No request body.

**Response `200`** — a full technician object with all fields visible
(owner view).

**Errors**

| Status | When |
| --- | --- |
| `401` | Missing or invalid token |
| `403` | Caller is not a `TECHNICIAN` |
| `404` | No profile registered yet — register first with `POST` |

### `PUT /api/v1/technicians/profile`

Updates the signed-in technician's profile.

Auth: **`TECHNICIAN`**.

Send only the fields you want to change. At least one field is required.

- If `serviceExperiences` is present, it **replaces** the current list.
- `baseLatitude`/`baseLongitude` must be sent as a pair.
- `nationalIdNumber` cannot be cleared once set.

**Request** — any subset of the fields accepted by `POST`, plus:

```json
{
  "availabilityStatus": "ONLINE",
  "serviceExperiences": [
    { "categoryId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100", "yearsOfExperience": 6 }
  ]
}
```

**Response `200`** — the updated full technician object.

**Errors**

| Status | When |
| --- | --- |
| `400` | Empty body, or the same per-field rules as `POST` |
| `400` | `nationalIdNumber` sent empty |
| `401` / `403` | Missing token or wrong role |
| `404` | No profile registered yet |
| `409` | `phoneNumber`, `email`, or `nationalIdNumber` collides with another user |
| `409` | Tried to go `ONLINE` while not `APPROVED` |
| `409` | Concurrent update — retry |

### `PATCH /api/v1/technicians/availability`

Changes the technician's availability.

Auth: **`TECHNICIAN`**.

A technician can go `ONLINE` **only** while `verificationStatus` is
`APPROVED` and the user is `ACTIVE`. Setting any other availability works
regardless.

**Request**

```json
{ "availabilityStatus": "ONLINE" }
```

**Response `200`** — the updated full technician object.

**Errors**

| Status | When |
| --- | --- |
| `400` | `availabilityStatus` missing or not a valid enum value |
| `401` / `403` | Missing token or wrong role |
| `404` | No profile registered yet |
| `409` | Going `ONLINE` while `PENDING`/`REJECTED`, or while the user is `INACTIVE` |

## Discovery (any signed-in role)

The next four endpoints serve `CUSTOMER`, `TECHNICIAN`, and `ADMIN` tokens.
The values returned depend on the caller: an admin sees everything; a
signed-in customer or technician sees contact fields but **not** payment or
national ID.

### `GET /api/v1/technicians`

Lists active, approved, online technicians.

Auth: **any signed-in role**.

Optional query parameters:

- `categoryId` — UUID of a service category. Only technicians who list that
  category appear.
- `query` — free text; matches user full name, `publicLocationLabel`,
  `baseAddress`, or a service category name / custom service name.

**Response `200`** — an array of technician objects (`200` with `[]` when
there are no matches).

**Errors**

| Status | When |
| --- | --- |
| `400` | `categoryId` present but not a UUID |
| `401` | No token |

### `GET /api/v1/technicians/approved`

Lists active, approved technicians regardless of availability (both `ONLINE`
and `OFFLINE`).

Auth: **any signed-in role**.

Accepts the same `categoryId` and `query` filters as `GET /api/v1/technicians`.

**Response `200`** — array of technician objects.

### `GET /api/v1/technicians/available/:id`

Returns one active, approved, **online** technician by profile ID.

Auth: **any signed-in role**.

**Response `200`** — one technician object.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:id` is not a UUID |
| `404` | No such technician, or the technician is not currently available |

### `GET /api/v1/technicians/approved/:id`

Returns one active, approved technician by profile ID, online or offline.

Auth: **any signed-in role**.

**Response `200`** — one technician object.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:id` is not a UUID |
| `404` | No such technician, or the technician is not approved |

## Public discovery (no auth)

### `GET /api/v1/public/technicians`

Lists active, approved, online technicians with a privacy-safe projection:
`user` contains only `id`, `fullName`, and `role`; `phoneNumber`, `email`,
`status`, `createdAt`, `updatedAt`, `nationalIdNumber`, `paymentMethod`, and
`paymentNumber` are `null`.

Auth: **none**.

Accepts `categoryId` and `query` filters.

**Response `200`** — array of technician objects.

### `GET /api/v1/public/technicians/:id`

Returns one active, approved, online technician with the same privacy-safe
projection as the list endpoint.

Auth: **none**.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:id` is not a UUID |
| `404` | No such technician or the technician is not available |

## Administrator management

All routes in this section require `ADMIN`.

### `POST /api/v1/admin/technicians`

Creates a technician `User` and profile in one transaction.

Required: `user.fullName`, `user.phoneNumber`, and — inside `profile` — the
same required fields as the self-service `POST /profile`:
`gender`, `nationalIdNumber`, `baseAddress`, `baseLatitude`,
`baseLongitude`, `paymentMethod`, `paymentNumber`, `serviceExperiences`.

New technicians always start `verificationStatus: "PENDING"` and
`availabilityStatus: "OFFLINE"`. `availabilityStatus: "ONLINE"` in the
request is rejected.

**Request**

```json
{
  "user": {
    "fullName": "Amina Example",
    "phoneNumber": "+250788123456",
    "email": "amina@example.com"
  },
  "profile": {
    "gender": "FEMALE",
    "nationalIdNumber": "ID123456",
    "baseAddress": "Kigali, Rwanda",
    "publicLocationLabel": "Kigali, Rwanda",
    "baseLatitude": -1.95,
    "baseLongitude": 30.06,
    "paymentMethod": "MOMO",
    "paymentNumber": "+250788123456",
    "serviceExperiences": [
      { "categoryId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100", "yearsOfExperience": 5 }
    ]
  }
}
```

**Response `201`** — the created technician object (`admin` view: all fields visible).

**Errors**

| Status | When |
| --- | --- |
| `400` | Missing user identity or profile required fields |
| `400` | Same per-field rules as self-registration |
| `401` / `403` | Missing token or non-admin |
| `409` | `phoneNumber`, `email`, or `nationalIdNumber` already used |

### `GET /api/v1/admin/technicians`

Lists every technician regardless of status or availability.

Auth: **`ADMIN`**.

**Response `200`** — array of technician objects, newest first.

### `GET /api/v1/admin/technicians/search`

Multi-field search. Returns **every** match, not just the first.

Auth: **`ADMIN`**.

Query parameters:

| Name | Type | Matches |
| --- | --- | --- |
| `query` | string | user full name, user phone, user email, `baseAddress`, `publicLocationLabel`, service category name, custom service name — and exact numeric `baseLatitude`, `baseLongitude` |
| `nationalIdNumber` | string | exact match against the keyed digest of the national ID |
| `categoryId` | UUID | technicians who list this category |
| `verificationStatus` | enum | `PENDING`, `APPROVED`, `REJECTED` |
| `availabilityStatus` | enum | `ONLINE`, `OFFLINE` |

All supplied filters are AND-combined.

Example:

```
/api/v1/admin/technicians/search?query=Kigali&categoryId=e5a4f4d7-0b21-46d8-9a4b-98765d332100
```

**Response `200`** — array of technician objects (`admin` view).

### `GET /api/v1/admin/technicians/by-user`

Returns every technician whose linked `User` matches the given account
attributes. At least one filter is required.

Auth: **`ADMIN`**.

Query parameters:

| Name | Type |
| --- | --- |
| `userId` | UUID |
| `phoneNumber` | E.164-ish; digits with optional leading `+` |
| `email` | email |
| `fullName` | partial, case-insensitive |

Supplied filters are AND-combined.

**Response `200`** — array of technician objects (`admin` view); `[]` when
none match.

**Errors**

| Status | When |
| --- | --- |
| `400` | No filter supplied |
| `400` | `userId` not a UUID, `email` not an email, etc. |
| `401` / `403` | Missing token or non-admin |

### `GET /api/v1/admin/technicians/:id`

Returns one technician by profile ID regardless of status.

Auth: **`ADMIN`**.

**Response `200`** — one technician object (`admin` view).

**Errors**

| Status | When |
| --- | --- |
| `400` | `:id` is not a UUID |
| `404` | No such technician |

### `PATCH /api/v1/admin/technicians/:id`

Updates any combination of user, profile, service experiences, and status
fields. Body fields are the union of:

- `fullName`, `phoneNumber`, `email`
- `gender`, `nationalIdNumber`, `baseAddress`, `publicLocationLabel`, `baseLatitude`, `baseLongitude`
- `paymentMethod`, `paymentNumber`
- `serviceExperiences`
- `availabilityStatus`
- `verificationStatus` (admin-only)

**Setting `verificationStatus` to `APPROVED` triggers the approval
checklist**: the technician must have a profile picture, an accepted
`NATIONAL_ID` document, and an accepted `TVET_CERTIFICATE` document. If any
are missing the request returns `400` and nothing is written.

Changing `verificationStatus` away from `APPROVED` forces
`availabilityStatus` to `OFFLINE`.

**Response `200`** — the updated technician object (`admin` view).

**Errors**

| Status | When |
| --- | --- |
| `400` | Empty body or any per-field validation failure |
| `400` | Approval attempted with missing checklist items |
| `401` / `403` | Missing token or non-admin |
| `404` | Technician not found |
| `409` | Unique-field collision or concurrent update |

### `PATCH /api/v1/admin/technicians/:id/verification-status`

Shortcut for changing only the verification state.

Auth: **`ADMIN`**.

**Request**

```json
{ "verificationStatus": "APPROVED" }
```

**Response `200`** — the updated technician object.

**Errors** — same as `PATCH /api/v1/admin/technicians/:id` when only
verification is changed.

### `PATCH /api/v1/admin/technicians/:id/availability-status`

Shortcut for changing only availability.

Auth: **`ADMIN`**.

**Request**

```json
{ "availabilityStatus": "ONLINE" }
```

**Response `200`** — the updated technician object.

**Errors**

| Status | When |
| --- | --- |
| `400` | Invalid enum value |
| `404` | Technician not found |
| `409` | Setting `ONLINE` on an inactive or unapproved technician |

### `DELETE /api/v1/admin/technicians/:id`

Deletes the technician `User` (cascading to the profile, documents, sessions,
and category links). The deletion is written to the audit log.

Auth: **`ADMIN`**.

**Response `200`**

```json
{ "message": "Technician deleted successfully." }
```

**Errors**

| Status | When |
| --- | --- |
| `400` | `:id` is not a UUID |
| `404` | Technician not found |
| `401` / `403` | Missing token or non-admin |

## Full technician response shape

Every endpoint above returns this shape. Redacted values are `null` rather
than omitted, so clients can rely on a stable key set.

```json
{
  "id": "generated-profile-id",
  "user": {
    "id": "generated-user-id",
    "fullName": "Amina Example",
    "role": "TECHNICIAN",
    "phoneNumber": "+250788123456",
    "email": "amina@example.com",
    "status": "ACTIVE",
    "createdAt": "2026-10-01T10:00:00.000Z",
    "updatedAt": "2026-10-01T10:00:00.000Z"
  },
  "gender": "FEMALE",
  "yearsOfExperience": 5,
  "serviceExperiences": [
    {
      "categoryId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
      "category": { "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100", "name": "Plumbing", "slug": "plumbing" },
      "customName": null,
      "yearsOfExperience": 5
    },
    {
      "categoryId": null,
      "category": null,
      "customName": "Solar panel install",
      "yearsOfExperience": 2
    }
  ],
  "verificationStatus": "PENDING",
  "availabilityStatus": "OFFLINE",
  "location": {
    "address": "Kigali, Rwanda",
    "publicLocationLabel": "Kigali, Rwanda",
    "latitude": -1.95,
    "longitude": 30.06
  },
  "profilePictureUrl": "https://storage.example.com/signed-url",
  "nationalIdNumber": "ID123456",
  "paymentMethod": "MOMO",
  "paymentNumber": "+250788123456",
  "createdAt": "2026-10-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T10:00:00.000Z"
}
```

`profilePictureUrl` is a signed URL that expires after 10 minutes. Uploading
a new picture replaces the old one; see
[`technician-documents.md`](./technician-documents.md) for the upload rules.

## Enums

| Enum | Values |
| --- | --- |
| `verificationStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `availabilityStatus` | `ONLINE`, `OFFLINE` |
| `gender` | `FEMALE`, `MALE`, `NON_BINARY`, `PREFER_NOT_TO_SAY` |
| `paymentMethod` | `MOMO`, `BANK_TRANSFER`, `CASH`, `OTHER` |

## Errors

Every error response has the same shape:

```json
{
  "statusCode": 400,
  "timestamp": "2026-10-06T10:00:00.000Z",
  "path": "/api/v1/technicians/profile",
  "message": "Missing required technician fields: gender, paymentMethod."
}
```

The `message` is always a specific, human-readable string — never a generic
`"Internal server error"` for expected failures. Typical cases are documented
per endpoint above. In addition to those, global statuses you may see are:

| Status | Cause |
| --- | --- |
| `401` | No token, expired token, or malformed `Authorization` header |
| `403` | Token belongs to a different role than required |
| `500` | Unexpected server error — please report with the request path and timestamp |