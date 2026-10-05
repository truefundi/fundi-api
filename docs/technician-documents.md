# Technician Documents and Profile Pictures API

This API manages the files a technician submits to get verified: a profile picture and identity/qualification documents. Files are stored in private S3-compatible storage (RustFS, MinIO, or AWS S3). The database keeps only metadata and an internal object key, and the object key is never returned by the API. These are three separate concepts:

- **Profile picture** is a single image shown on the technician's profile. Uploading a new one replaces the old one.
- **Documents** are verification files (`NATIONAL_ID`, `TVET_CERTIFICATE`). Each has a review `status` set by an administrator.
- **Verification** (`verificationStatus` on the technician profile) can only become `APPROVED` once the approval checklist is satisfied.

Technician routes require a `TECHNICIAN` access token. Admin routes require an `ADMIN` access token. Uploads use `multipart/form-data`; every other request body is JSON with `Content-Type: application/json`.

## Upload rules

- Profile picture: JPEG, PNG, or WebP.
- Documents: JPEG, PNG, WebP, or PDF.
- Maximum 5 MiB per file.
- The real file type is detected from the file's bytes. The type sent by the client is ignored.
- The file goes in a form field named `file`.
- A technician can hold at most 10 non-denied documents.
- Titles must be unique among a technician's non-denied documents.
- Only one non-denied `NATIONAL_ID` is allowed. A duplicate title or National ID returns `409`. Both rules are enforced by database indexes.

## Document statuses

| Status | Meaning |
| --- | --- |
| `SUBMITTED` | Uploaded and waiting for an administrator. |
| `REVIEWING` | An administrator has started reviewing it (optional step). |
| `ACCEPTED` | Approved. Final: it can no longer be deleted or changed. |
| `DENIED` | Rejected, with a review note. Final: upload a new document to replace it. |

Flow: `SUBMITTED` → `REVIEWING` (optional) → `ACCEPTED` or `DENIED`. Every upload, review, and deletion is written to the audit log.

## Technician self-service

The technician must register a profile first (`POST /api/v1/technicians/profile`). Otherwise these routes return `404`.

### `PUT /api/v1/technicians/profile/picture`

Uploads the profile picture and replaces the previous one. Send `multipart/form-data` with the image in the `file` field.

Request:

```bash
curl -X PUT http://localhost:3000/api/v1/technicians/profile/picture \
  -H "Authorization: Bearer <technician-token>" \
  -F "file=@/path/to/photo.png"
```

Success response (`200`): the full technician object (see [Full technician response](#full-technician-response)) with a new `profilePictureUrl`.

### `DELETE /api/v1/technicians/profile/picture`

Removes the profile picture. No request body.

Success response (`200`): the full technician object with `profilePictureUrl` set to `null`.

### `POST /api/v1/technicians/profile/documents`

Uploads a verification document. Send `multipart/form-data` with these fields:

- `file`: the document (JPEG, PNG, WebP, or PDF, up to 5 MiB).
- `type`: `NATIONAL_ID` or `TVET_CERTIFICATE`.
- `title`: a label for the document, unique among your non-denied documents.

The document starts as `SUBMITTED`.

Request:

```bash
curl -X POST http://localhost:3000/api/v1/technicians/profile/documents \
  -H "Authorization: Bearer <technician-token>" \
  -F "file=@/path/to/national-id.pdf" \
  -F "type=NATIONAL_ID" \
  -F "title=National ID card"
```

Success response (`201`): the created document object (see [Document response](#document-response)).

### `GET /api/v1/technicians/profile/documents`

Lists the signed-in technician's own documents with their status and review note. No request body. Returns an array; no documents returns `[]`.

### `GET /api/v1/technicians/profile/documents/:documentId/download`

Downloads one of your own documents as a file attachment. Replace `:documentId` with the document ID. No request body.

Success response (`200`): the file bytes with a `Content-Disposition: attachment` header.

### `DELETE /api/v1/technicians/profile/documents/:documentId`

Deletes one of your own documents. Allowed only while the document is `SUBMITTED` or `DENIED`. No request body.

Success response (`200`): confirmation that the document was deleted. A document that is `REVIEWING` or `ACCEPTED` cannot be deleted.

### `GET /api/v1/technicians/profile/verification-checklist`

Shows what is still missing before an administrator can approve the profile. No request body.

Success response (`200`): the checklist (see [Verification checklist](#verification-checklist)).

## Administrator management

All endpoints in this section require an `ADMIN` access token.

### `GET /api/v1/admin/technicians/:id/documents`

Lists all documents of a technician profile, including their status and review note. Replace `:id` with the technician profile ID. No request body.

Success response (`200`): an array of document objects.

### `GET /api/v1/admin/technicians/:id/verification-checklist`

Shows whether a technician is ready for approval. Replace `:id` with the technician profile ID. No request body.

Success response (`200`): the checklist (see [Verification checklist](#verification-checklist)).

### `GET /api/v1/admin/technician-documents/:documentId/download`

Downloads any technician document for review. Replace `:documentId` with the document ID. No request body.

Success response (`200`): the file bytes with a `Content-Disposition: attachment` header.

### `PATCH /api/v1/admin/technician-documents/:documentId/review`

Moves a document through the review flow. `status` is one of `REVIEWING`, `ACCEPTED`, or `DENIED`. A `reviewNote` is required when denying and optional otherwise. `ACCEPTED` and `DENIED` are final.

Request:

```json
{
  "status": "DENIED",
  "reviewNote": "The photo is blurry. Please upload a clearer scan."
}
```

Success response (`200`): the updated document object.

## Approving a technician

Setting `verificationStatus` to `APPROVED` (through `PATCH /api/v1/admin/technicians/:id` or `PATCH /api/v1/admin/technicians/:id/verification-status`) is blocked unless the technician has all of the following:

- a profile picture,
- an `ACCEPTED` `NATIONAL_ID` document,
- an `ACCEPTED` `TVET_CERTIFICATE` document.

If anything is missing, the request returns `400` with the list of missing items and nothing is changed.

## Typical flow

1. The technician registers a profile: `POST /api/v1/technicians/profile`.
2. The technician uploads a profile picture and both documents.
3. The technician checks progress with `GET /api/v1/technicians/profile/verification-checklist`.
4. An administrator downloads and reviews each document, then accepts or denies it.
5. When the checklist is complete, the administrator sets `verificationStatus` to `APPROVED`.
6. The technician can now go `ONLINE`.

If a document is denied, the technician reads the `reviewNote`, deletes nothing (denied documents stay for the record), and uploads a replacement.

## Document response

Documents never include the storage object key.

```json
{
  "id": "generated-document-id",
  "type": "NATIONAL_ID",
  "title": "National ID card",
  "status": "DENIED",
  "reviewNote": "The photo is blurry. Please upload a clearer scan.",
  "createdAt": "2026-10-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T10:30:00.000Z"
}
```

`reviewNote` is `null` until an administrator adds one.

## Verification checklist

```json
{
  "ready": false,
  "missing": ["PROFILE_PICTURE", "TVET_CERTIFICATE"]
}
```

`ready` is `true` and `missing` is empty when the technician can be approved.

## Full technician response

The technician object returned by profile reads and writes now exposes the picture as `profilePictureUrl` instead of a base64 data URL.

```json
{
  "id": "generated-profile-id",
  "user": {
    "id": "generated-user-id",
    "fullName": "Amina Example",
    "phoneNumber": "+250788123456",
    "email": "amina@example.com",
    "role": "TECHNICIAN",
    "status": "ACTIVE",
    "createdAt": "2026-10-01T10:00:00.000Z",
    "updatedAt": "2026-10-01T10:00:00.000Z"
  },
  "gender": "FEMALE",
  "yearsOfExperience": 5,
  "verificationStatus": "PENDING",
  "availabilityStatus": "OFFLINE",
  "categories": [
    {
      "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
      "name": "Plumbing",
      "slug": "plumbing"
    }
  ],
  "location": {
    "address": "Kigali, Rwanda",
    "publicLocationLabel": "Kigali, Rwanda",
    "latitude": -1.95,
    "longitude": 30.06
  },
  "profilePictureUrl": "https://storage.example.com/signed-url",
  "createdAt": "2026-10-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T10:00:00.000Z"
}
```

`profilePictureUrl` is a link that expires after 10 minutes. It is `null` when there is no picture, or when `STORAGE_DRIVER=local`. Request a fresh technician object to get a new link.

## Changes from the earlier API

- `profilePicture` (a base64 data URL) is replaced by `profilePictureUrl`.
- The request fields `profilePictureBase64` and `profilePictureMimeType` are removed from `PUT /api/v1/technicians/profile`. Use `PUT /api/v1/technicians/profile/picture` instead.

## Errors

The global error response contains `statusCode`, `timestamp`, `path`, and `message`. Common statuses are:

- `400` for a missing or invalid file, an unsupported file type, a file over 5 MiB, a missing `type` or `title`, a missing `reviewNote` when denying, or an approval attempted with missing checklist items.
- `401` for missing or invalid authentication.
- `403` for a role restriction, or for accessing another technician's document.
- `404` for a missing technician profile or document.
- `409` for a duplicate title, a second non-denied National ID, or a concurrent update that should be retried.