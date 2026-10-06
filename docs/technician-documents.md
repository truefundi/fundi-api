# Technician Documents and Profile Pictures API

This API manages the files a technician submits to get verified: a profile
picture and identity/qualification documents. Files are stored in private
S3-compatible storage (RustFS, MinIO, or AWS S3). The database keeps only
metadata and an internal object key, and the object key is never returned by
the API. These are three separate concepts:

- **Profile picture** is a single image shown on the technician's profile.
  Uploading a new one replaces the old one.
- **Documents** are verification files. A document is either a
  **`NATIONAL_ID`** (an identity card) or a **`CERTIFICATE`** (a
  qualification). Each certificate records a `certificateType` and links to a
  service category. Every document has a review `status` set by an
  administrator.
- **Verification** (`verificationStatus` on the technician profile) can only
  become `APPROVED` once the approval checklist is satisfied.

Technician routes require a `TECHNICIAN` access token. Admin routes require an
`ADMIN` access token. Uploads use `multipart/form-data`; every other request
body is JSON with `Content-Type: application/json`.

## Upload rules

- Profile picture: JPEG, PNG, or WebP.
- Documents: JPEG, PNG, WebP, or PDF.
- Maximum **5 MiB** per file.
- The real file type is detected from the file's bytes. The `Content-Type`
  sent by the client is ignored.
- The file goes in a form field named **`file`**.
- A technician can hold at most **10** non-denied documents.
- Titles must be unique among a technician's non-denied documents.
- **Only one live `NATIONAL_ID`** is allowed.
- A **`CERTIFICATE`** additionally requires:
  - `certificateType` — see [Certificate types](#certificate-types).
  - Exactly one of `categoryId` (an active service-category UUID) **or**
    `customCategoryName` (a free-text service name for a service that is not
    yet in the catalogue).
- At most one live `CERTIFICATE` per `(technician, category-or-custom-name,
  certificateType)`. Uploading a second certificate for the same
  combination while the first is still live returns `409`.

## Certificate types

`CERTIFICATE` documents carry a `certificateType`:

| Value | Meaning |
| --- | --- |
| `TVET_CERTIFICATE` | Rwanda TVET Board qualification |
| `DIPLOMA` | Diploma |
| `ADVANCED_DIPLOMA` | Advanced diploma |
| `DEGREE` | Degree |
| `SHORT_COURSE` | Short course completion |
| `OTHER` | Anything else |

A certificate also links to the service it qualifies the technician for. The
technician picks either a real service category (`categoryId`) or types a
name (`customCategoryName`) if the service is not in the catalogue yet. The
approval checklist specifically requires an accepted certificate of type
`TVET_CERTIFICATE`.

## Document statuses

| Status | Meaning |
| --- | --- |
| `SUBMITTED` | Uploaded and waiting for an administrator. |
| `REVIEWING` | An administrator has started reviewing it (optional step). |
| `ACCEPTED` | Approved. Final: it can no longer be deleted or changed. |
| `DENIED` | Rejected, with a review note. Final: upload a new document to replace it. |

Flow: `SUBMITTED` → `REVIEWING` (optional) → `ACCEPTED` or `DENIED`. Every
upload, review, and deletion is written to the audit log.

## Technician self-service

The technician must register a profile first
(`POST /api/v1/technicians/profile`). Otherwise these routes return `404`.

### `PUT /api/v1/technicians/profile/picture`

Uploads the profile picture and replaces the previous one. Send
`multipart/form-data` with the image in the `file` field.

Request:

```bash
curl -X PUT http://localhost:3000/api/v1/technicians/profile/picture \
  -H "Authorization: Bearer <technician-token>" \
  -F "file=@/path/to/photo.png"
```

Success response (`200`): the full technician object (see
[Full technician response](#full-technician-response)) with a new
`profilePictureUrl`.

**Errors**

| Status | When |
| --- | --- |
| `400` | No file, unsupported type (e.g. PDF, GIF), or file over 5 MiB |
| `401` | Missing or invalid token |
| `403` | Caller is not a `TECHNICIAN` |
| `404` | No technician profile registered yet |
| `409` | Concurrent update — retry |

### `DELETE /api/v1/technicians/profile/picture`

Removes the profile picture. No request body.

Success response (`200`): the full technician object with
`profilePictureUrl` set to `null`. A request when there is no picture is a
no-op and still returns `200`.

### `POST /api/v1/technicians/profile/documents`

Uploads a verification document. Send `multipart/form-data`.

**Fields**

| Name | Required | Notes |
| --- | --- | --- |
| `file` | Yes | JPEG, PNG, WebP, or PDF; up to 5 MiB |
| `type` | Yes | `NATIONAL_ID` or `CERTIFICATE` |
| `title` | Yes | Unique among the technician's non-denied documents |
| `certificateType` | When `type=CERTIFICATE` | See [Certificate types](#certificate-types) |
| `categoryId` | When `type=CERTIFICATE` — mutually exclusive with `customCategoryName` | UUID of an active `ServiceCategory` |
| `customCategoryName` | When `type=CERTIFICATE` — mutually exclusive with `categoryId` | Free-text service name |

The document starts as `SUBMITTED`.

**Request — a National ID**

```bash
curl -X POST http://localhost:3000/api/v1/technicians/profile/documents \
  -H "Authorization: Bearer <technician-token>" \
  -F "file=@/path/to/national-id.jpg" \
  -F "type=NATIONAL_ID" \
  -F "title=National ID card"
```

**Request — a certificate linked to a catalogued service**

```bash
curl -X POST http://localhost:3000/api/v1/technicians/profile/documents \
  -H "Authorization: Bearer <technician-token>" \
  -F "file=@/path/to/certificate.pdf" \
  -F "type=CERTIFICATE" \
  -F "certificateType=TVET_CERTIFICATE" \
  -F "categoryId=e5a4f4d7-0b21-46d8-9a4b-98765d332100" \
  -F "title=TVET Certificate — Plumbing"
```

**Request — a certificate for a service not yet in the catalogue**

```bash
curl -X POST http://localhost:3000/api/v1/technicians/profile/documents \
  -H "Authorization: Bearer <technician-token>" \
  -F "file=@/path/to/diploma.pdf" \
  -F "type=CERTIFICATE" \
  -F "certificateType=DIPLOMA" \
  -F "customCategoryName=Solar Panel Install" \
  -F "title=Diploma — Solar Panel Install"
```

Success response (`201`): the created document object (see
[Document response](#document-response)).

**Errors**

| Status | When |
| --- | --- |
| `400` | No file, unsupported type, or file over 5 MiB |
| `400` | Missing `type` or `title` |
| `400` | `type=CERTIFICATE` but no `certificateType` |
| `400` | `type=CERTIFICATE` and both or neither of `categoryId` / `customCategoryName` |
| `400` | `categoryId` is not an active category |
| `401` | Missing or invalid token |
| `403` | Caller is not a `TECHNICIAN` |
| `404` | No technician profile registered yet |
| `409` | Duplicate title, second live `NATIONAL_ID`, or duplicate live certificate for the same `(category, certificateType)` |
| `409` | More than 10 non-denied documents |

### `GET /api/v1/technicians/profile/documents`

Lists the signed-in technician's own documents with their status and review
note. No request body.

Success response (`200`): an array of document objects. No documents returns
`[]`.

### `GET /api/v1/technicians/profile/documents/:documentId/download`

Downloads one of your own documents as a file attachment. Replace
`:documentId` with the document ID. No request body.

Success response (`200`): the file bytes with a
`Content-Disposition: attachment` header.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:documentId` is not a UUID |
| `404` | Document not found, or not owned by the caller |

### `DELETE /api/v1/technicians/profile/documents/:documentId`

Deletes one of your own documents. Allowed only while the document is
`SUBMITTED` or `DENIED`. No request body.

Success response (`200`):

```json
{ "message": "Document deleted successfully." }
```

A document that is `REVIEWING` or `ACCEPTED` cannot be deleted.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:documentId` is not a UUID |
| `404` | Document not found, or not owned by the caller |
| `409` | Document is `REVIEWING` or `ACCEPTED` |

### `GET /api/v1/technicians/profile/verification-checklist`

Shows what is still missing before an administrator can approve the profile.
No request body.

Success response (`200`): the checklist (see
[Verification checklist](#verification-checklist)).

## Administrator management

All endpoints in this section require an `ADMIN` access token.

### `GET /api/v1/admin/technicians/:id/documents`

Lists all documents of a technician profile, including their status and
review note. Replace `:id` with the technician profile ID. No request body.

Success response (`200`): an array of document objects with
`reviewedById` exposed as well.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:id` is not a UUID |
| `404` | Technician not found |

### `GET /api/v1/admin/technicians/:id/verification-checklist`

Shows whether a technician is ready for approval. Replace `:id` with the
technician profile ID. No request body.

Success response (`200`): the checklist (see
[Verification checklist](#verification-checklist)).

### `GET /api/v1/admin/technician-documents/:documentId/download`

Downloads any technician document for review. Replace `:documentId` with the
document ID. No request body.

Success response (`200`): the file bytes with a
`Content-Disposition: attachment` header.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:documentId` is not a UUID |
| `404` | Document not found |

### `PATCH /api/v1/admin/technician-documents/:documentId/review`

Moves a document through the review flow.

`status` is one of `REVIEWING`, `ACCEPTED`, or `DENIED`. A `reviewNote` is
required when denying and optional otherwise. `ACCEPTED` and `DENIED` are
final.

Allowed transitions:

- `SUBMITTED` → `REVIEWING`, `ACCEPTED`, or `DENIED`
- `REVIEWING` → `ACCEPTED` or `DENIED`
- `ACCEPTED` / `DENIED` → none (a second attempt returns `409`)

Request:

```json
{
  "status": "DENIED",
  "reviewNote": "The photo is blurry. Please upload a clearer scan."
}
```

Success response (`200`): the updated document object.

**Errors**

| Status | When |
| --- | --- |
| `400` | `:documentId` is not a UUID |
| `400` | `status` is not one of the allowed values |
| `400` | `status=DENIED` without a `reviewNote` |
| `404` | Document not found |
| `409` | The document is already decided and cannot move to the requested status |

## Approving a technician

Setting `verificationStatus` to `APPROVED` (through
`PATCH /api/v1/admin/technicians/:id` or
`PATCH /api/v1/admin/technicians/:id/verification-status`) is blocked unless
the technician has all of the following:

- a **profile picture**,
- an **`ACCEPTED` `NATIONAL_ID`** document,
- an **`ACCEPTED` `CERTIFICATE`** document whose `certificateType` is
  **`TVET_CERTIFICATE`**.

If anything is missing, the request returns `400` with the list of missing
items and nothing is changed. The checklist payload is included in the error
response so the caller can render the same view as
`GET .../verification-checklist`.

## Typical flow

1. The technician registers a profile: `POST /api/v1/technicians/profile`.
2. The technician uploads a profile picture and both documents — a
   `NATIONAL_ID` and a `CERTIFICATE` of type `TVET_CERTIFICATE` linked to a
   service category.
3. The technician checks progress with
   `GET /api/v1/technicians/profile/verification-checklist`.
4. An administrator downloads and reviews each document, then accepts or
   denies it.
5. When the checklist is complete, the administrator sets
   `verificationStatus` to `APPROVED`.
6. The technician can now go `ONLINE`.

If a document is denied, the technician reads the `reviewNote`, deletes
nothing (denied documents stay for the record), and uploads a replacement.
The technician may also upload additional `CERTIFICATE` documents for other
categories or other certificate types at any time — the checklist only
requires one accepted `TVET_CERTIFICATE`, not one per category.

## Document response

Documents never include the storage object key.

```json
{
  "id": "generated-document-id",
  "technicianId": "generated-profile-id",
  "type": "CERTIFICATE",
  "title": "TVET Certificate — Plumbing",
  "certificateType": "TVET_CERTIFICATE",
  "categoryId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
  "category": {
    "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
    "name": "Plumbing",
    "slug": "plumbing"
  },
  "customCategoryName": null,
  "mimeType": "application/pdf",
  "originalFileName": "certificate.pdf",
  "sizeBytes": 184320,
  "status": "SUBMITTED",
  "reviewNote": null,
  "reviewedAt": null,
  "createdAt": "2026-10-06T10:00:00.000Z",
  "updatedAt": "2026-10-06T10:00:00.000Z"
}
```

`categoryId` and `category` are populated when the technician picked a real
category; `customCategoryName` is `null` in that case. When the technician
typed a custom name instead, `categoryId` and `category` are `null` and
`customCategoryName` holds the typed value. For a `NATIONAL_ID`,
`certificateType`, `categoryId`, `category`, and `customCategoryName` are
all `null`.

`reviewNote` is `null` until an administrator adds one. `reviewedById` is
only returned to administrators.

## Verification checklist

```json
{
  "complete": false,
  "items": [
    {
      "key": "PROFILE_PICTURE",
      "label": "Profile picture",
      "satisfied": false,
      "detail": "Not uploaded"
    },
    {
      "key": "NATIONAL_ID",
      "label": "Accepted National ID document",
      "satisfied": false,
      "detail": "Submitted, waiting for review"
    },
    {
      "key": "CERTIFICATE",
      "label": "Accepted TVET certificate",
      "satisfied": false,
      "detail": "Not uploaded"
    }
  ]
}
```

`complete` is `true` and every item is `satisfied` when the technician can be
approved. `detail` reflects the current state of the underlying document:
`"Not uploaded"`, `"Submitted, waiting for review"`, `"Under review"`,
`"Accepted"`, or `"Denied, upload a new document"`.

## Full technician response

The technician object returned by profile reads and writes exposes the
picture as `profilePictureUrl` instead of a base64 data URL.

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
      "category": {
        "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
        "name": "Plumbing",
        "slug": "plumbing"
      },
      "customName": null,
      "yearsOfExperience": 5
    },
    {
      "categoryId": null,
      "category": null,
      "customName": "Solar Panel Install",
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

`profilePictureUrl` is a link that expires after 10 minutes. It is `null`
when there is no picture, or when `STORAGE_DRIVER=local`. Request a fresh
technician object to get a new link.

Field visibility depends on the caller: `nationalIdNumber`, `paymentMethod`,
and `paymentNumber` are only returned to the technician and to administrators;
they are `null` for other signed-in users and for anonymous callers. See
[`technician-onboarding.md`](./technician-onboarding.md) for the full
redaction matrix.

## Changes from the earlier API

- `type` now has values `NATIONAL_ID` and `CERTIFICATE` only. The previous
  `TVET_CERTIFICATE` document type is now `type=CERTIFICATE` plus
  `certificateType=TVET_CERTIFICATE`.
- Certificate documents carry `certificateType`, `categoryId` / `category`,
  and `customCategoryName`.
- `profilePicture` (a base64 data URL) is replaced by `profilePictureUrl`.
- The request fields `profilePictureBase64` and `profilePictureMimeType` are
  removed from `PUT /api/v1/technicians/profile`. Use
  `PUT /api/v1/technicians/profile/picture` instead.

## Enums

| Enum | Values |
| --- | --- |
| `type` | `NATIONAL_ID`, `CERTIFICATE` |
| `certificateType` | `TVET_CERTIFICATE`, `DIPLOMA`, `ADVANCED_DIPLOMA`, `DEGREE`, `SHORT_COURSE`, `OTHER` |
| `status` | `SUBMITTED`, `REVIEWING`, `ACCEPTED`, `DENIED` |

## Errors

The global error response has the same shape everywhere:

```json
{
  "statusCode": 400,
  "timestamp": "2026-10-06T10:00:00.000Z",
  "path": "/api/v1/technicians/profile/documents",
  "message": "Provide exactly one of categoryId or customCategoryName for a certificate."
}
```

Common statuses:

- **`400`** — a missing or invalid file, an unsupported file type, a file
  over 5 MiB, a missing `type` or `title`, a certificate missing
  `certificateType` or a category reference, an invalid category, a missing
  `reviewNote` when denying, or an approval attempted with missing checklist
  items.
- **`401`** — missing or invalid authentication.
- **`403`** — a role restriction, or attempting to access another
  technician's document.
- **`404`** — a missing technician profile or document.
- **`409`** — a duplicate title, a second live `NATIONAL_ID`, a duplicate
  live certificate for the same `(category, certificateType)`, more than 10
  non-denied documents, a document that is already decided, or a concurrent
  update that should be retried.



  