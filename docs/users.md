# User Management API

All routes require `Authorization: Bearer <accessToken>`. Routes marked **Admin** additionally require the `ADMIN` role. Any active signed-in user may use the `/me` routes. Send `Content-Type: application/json` for requests with a body.

A full user record has this structure:

```json
{
  "id": "generated-user-id",
  "email": "prince@example.com",
  "phoneNumber": "+250788123456",
  "fullName": "Prince Example",
  "role": "CUSTOMER",
  "status": "ACTIVE",
  "createdAt": "2026-09-30T10:00:00.000Z",
  "updatedAt": "2026-09-30T10:00:00.000Z"
}
```

`email` is `null` if no email was provided. Roles are `CUSTOMER`, `TECHNICIAN`, and `ADMIN`; statuses are `ACTIVE` and `INACTIVE`.

## `GET /api/v1/users/me`

View the authenticated user's account. No request body.

Success response (`200`): one full user record.

## `PATCH /api/v1/users/me`

Update the authenticated user's profile. Only send fields to change. `role` and `status` cannot be changed through this route.

Request:

```json
{
  "fullName": "Prince N. Example",
  "phoneNumber": "+250788123457",
  "email": "prince.new@example.com"
}
```

Success response (`200`): the updated full user record.

## `DELETE /api/v1/users/me`

Delete the authenticated user's account. No request body.

Success response (`200`):

```json
{
  "message": "User deleted successfully."
}
```

## `POST /api/v1/users` (Admin)

Create an account. `email`, `role`, and `status` are optional; role defaults to `CUSTOMER` and status to `ACTIVE`.

Request:

```json
{
  "fullName": "Mugabe Example",
  "phoneNumber": "+250788123456",
  "email": "mugabe@example.com",
  "role": "TECHNICIAN",
  "status": "ACTIVE"
}
```

Success response (`201`): the created full user record.

## `GET /api/v1/users` (Admin)

List all accounts. No request body.

Success response (`200`): an array of full user records; if there are no users, the response is `[]`.

## `GET /api/v1/users/search?query=Jean` (Admin)

The `query` parameter is required and cannot be empty. Searches phone-number fragments or full-name fragments case-insensitively. All matching users are returned, including users with duplicate names. No request body.

Success response (`200`): an array of full user records.

## `GET /api/v1/users/by-email?email=jean%40example.com` (Admin)

Provide the email as a URL query parameter. No request body.

Success response (`200`): one full user record.

## `GET /api/v1/users/:id` (Admin)

Replace `:id` with the user's database ID. No request body.

Success response (`200`): one full user record.

## `PATCH /api/v1/users/:id` (Admin)

Replace `:id` with the user's database ID. Send only fields to change. Valid fields: `fullName`, `phoneNumber`, `email`, `role`, and `status`.

Request:

```json
{
  "role": "TECHNICIAN",
  "status": "ACTIVE"
}
```

Success response (`200`): the updated full user record.

## `PATCH /api/v1/users/:id/status` (Admin)

Replace `:id` with the user's database ID.

Request:

```json
{
  "status": "INACTIVE"
}
```

`status` must be `ACTIVE` or `INACTIVE`.

Success response (`200`): the updated full user record.

## `DELETE /api/v1/users/:id` (Admin)

Replace `:id` with the user's database ID. No request body.

Success response (`200`):

```json
{
  "message": "User deleted successfully."
}
```

## Provisioning the first administrator

Public registration cannot create an administrator. Verify the account identity out of band, then use a trusted database or seed process, for example:

```sql
UPDATE "users" SET "role" = 'ADMIN' WHERE "phoneNumber" = '+250788123456';
```

## Common errors

Errors have `statusCode`, `timestamp`, `path`, and `message` fields. Common status codes: `400` invalid or missing query/body fields; `401` missing, invalid, or revoked token; `403` inactive account or insufficient role; `404` user not found; `409` duplicate phone number or email.
