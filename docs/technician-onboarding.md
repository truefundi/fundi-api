# Technician Management API

This API manages technician identity, profile details, verification, and availability. These are three separate concepts:

- `user.status` controls whether the account is active and can authenticate.
- `verificationStatus` is the administrator's approval state: `PENDING`, `APPROVED`, or `REJECTED`.
- `availabilityStatus` says whether the technician is taking work: `ONLINE` or `OFFLINE`.

Technician routes require a `TECHNICIAN` access token. Customer discovery routes require a `CUSTOMER` token and only return active, approved, online technicians. Admin routes require an `ADMIN` token. Send JSON with `Content-Type: application/json`.

## Technician self-service

### `GET /api/v1/technicians/profile`

Returns the technician's account and profile. If no profile exists, the endpoint creates one as `PENDING` and `OFFLINE`. No request body.

### `PUT /api/v1/technicians/profile`

Updates user and technician profile fields in one request and database transaction. Send only fields to change; at least one field is required. `categoryIds` replaces the current category selection, and every selected category must be active. Latitude and longitude must be supplied together; set both to `null` to clear the location. Coordinates are decimal degrees: latitude ranges from -90 to 90, longitude from -180 to 180. The server also stores a PostGIS `geography(Point,4326)` value, using longitude as X and latitude as Y.

An optional profile photo is sent as base64 and stored in PostgreSQL binary form. JPEG, PNG, and WebP are accepted up to 5 MiB. The response converts the bytes into a displayable data URL.

Request:

```json
{
  "fullName": "Amina Example",
  "phoneNumber": "+250788123456",
  "email": "amina@example.com",
  "gender": "FEMALE",
  "yearsOfExperience": 5,
  "categoryIds": ["e5a4f4d7-0b21-46d8-9a4b-98765d332100"],
  "baseAddress": "Kigali, Rwanda",
  "baseLatitude": -1.95,
  "baseLongitude": 30.06,
  "profilePictureBase64": "<base64-image-data>",
  "profilePictureMimeType": "image/png"
}
```

Success response (`200`): a full technician object as shown below. `profilePicture` is a `data:<mime-type>;base64,...` URL or `null` when no picture is set.

### `PATCH /api/v1/technicians/availability`

Changes the signed-in technician's availability. A technician can go `ONLINE` only after administrator approval and while the user account is active.

Request:

```json
{
  "availabilityStatus": "OFFLINE"
}
```

Success response (`200`): the updated full technician object.

## Customer discovery

### `GET /api/v1/technicians`

Requires a signed-in customer. Returns only technicians with an active user account, `APPROVED` verification, and `ONLINE` availability. No request body. Returns an array; no matches returns `[]`.

### `GET /api/v1/technicians/:id`

Requires a signed-in customer. Replace `:id` with the technician profile ID. Pending, rejected, offline, or inactive technicians are not visible through this endpoint.

Success response (`200`): one full technician object. If the technician is not available, the API returns `404`.

## Administrator management

All endpoints in this section require an `ADMIN` access token.

### `POST /api/v1/admin/technicians`

Creates a technician account and profile in one transaction. `fullName` and `phoneNumber` are required; email and profile values are optional. New technicians start `PENDING` and `OFFLINE`.

Request:

```json
{
  "user": {
    "fullName": "Amina Example",
    "phoneNumber": "+250788123456",
    "email": "amina@example.com"
  },
  "profile": {
    "gender": "FEMALE",
    "yearsOfExperience": 5,
    "categoryIds": ["e5a4f4d7-0b21-46d8-9a4b-98765d332100"],
    "baseAddress": "Kigali, Rwanda",
    "baseLatitude": -1.95,
    "baseLongitude": 30.06
  }
}
```

Success response (`201`): the created full technician object.

### `GET /api/v1/admin/technicians`

Lists all technicians, including pending and offline records. No request body. Returns an array of full technician objects.

### `GET /api/v1/admin/technicians/:id`

Retrieves any technician by profile ID, regardless of verification or availability. No request body. Returns one full technician object.

### `GET /api/v1/admin/technicians/search`

Returns all matching technicians, not only the first match. Optional query parameters:

- `query`: partial full name, phone, email, address, category name, gender, or exact numeric latitude, longitude, or years of experience.
- `categoryId`: category UUID.
- `verificationStatus`: `PENDING`, `APPROVED`, or `REJECTED`.
- `availabilityStatus`: `ONLINE` or `OFFLINE`.

Supplied filters are combined; text search matches across fields. No request body.

Example: `/api/v1/admin/technicians/search?query=Kigali&categoryId=e5a4f4d7-0b21-46d8-9a4b-98765d332100`

Success response (`200`): an array of full technician objects.

### `PATCH /api/v1/admin/technicians/:id`

Updates account identity, profile fields, categories, photo, verification status, or availability status. Send only fields to change. The dedicated verification/availability routes below are also available when changing only those states.

Success response (`200`): the updated full technician object.

### `PATCH /api/v1/admin/technicians/:id/verification-status`

Changes the verification state. Changing it away from `APPROVED` automatically forces the technician offline.

Request:

```json
{
  "verificationStatus": "APPROVED"
}
```

Success response (`200`): the updated full technician object.

### `PATCH /api/v1/admin/technicians/:id/availability-status`

Changes availability. The service prevents inactive or unapproved technicians from being set online.

Request:

```json
{
  "availabilityStatus": "ONLINE"
}
```

Success response (`200`): the updated full technician object.

### `DELETE /api/v1/admin/technicians/:id`

Deletes the technician account, profile, login sessions, and category links. The deletion is audited. No request body.

Success response (`200`):

```json
{
  "message": "Technician deleted successfully."
}
```

## Full technician response

All technician reads and successful writes include account and profile details. `profilePicture` is a frontend-displayable data URL, not raw database bytes.

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
  "verificationStatus": "APPROVED",
  "availabilityStatus": "ONLINE",
  "categories": [
    {
      "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
      "name": "Plumbing",
      "slug": "plumbing"
    }
  ],
  "location": {
    "address": "Kigali, Rwanda",
    "latitude": -1.95,
    "longitude": 30.06
  },
  "profilePicture": "data:image/png;base64,<base64-image-data>",
  "createdAt": "2026-10-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T10:00:00.000Z"
}
```

`email` and `profilePicture` may be `null`. Gender values are `FEMALE`, `MALE`, `NON_BINARY`, and `PREFER_NOT_TO_SAY`.

## Errors

The global error response contains `statusCode`, `timestamp`, `path`, and `message`. Common statuses are `400` for invalid inputs or inactive categories, `401` for missing/invalid authentication, `403` for a role/account restriction, `404` for a missing technician or one unavailable to a customer, and `409` for duplicate contact values or a concurrent update that should be retried.

Profile pictures are stored in PostgreSQL binary form as requested. Payout details, document uploads, and job/dispatch workflows are later milestones.
