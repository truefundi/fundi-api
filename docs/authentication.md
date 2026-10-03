# Phone Authentication API

This guide covers customers and technicians, who sign in with a phone number and an SMS code and receive bearer tokens they hold themselves. Administrators sign in separately with an email address, a password, and a second SMS code; their session lives in `httpOnly` cookies instead of tokens. That flow is documented in [admin-authentication.md](admin-authentication.md). The two flows share no endpoints, and public registration cannot create an administrator.

Phone numbers are the login identifier. Public registration accepts `CUSTOMER` or `TECHNICIAN` (case-insensitive) and defaults to `CUSTOMER`; it cannot create an administrator. New accounts default to `ACTIVE`.

Send `Content-Type: application/json` for requests with a body. OTP hashes and resend/verification counters are stored temporarily in Redis, where the OTP key expires automatically after five minutes; PostgreSQL stores user and refresh-token data, not OTPs. During development, `SMS_MODE=console` prints OTP codes in the backend terminal, not in the HTTP response. OTPs can be resent at most three times and are rejected after five incorrect attempts. The five-attempt limit is counted per account rather than per code, so requesting or resending a new OTP does not reset it. After five incorrect guesses the account is locked out of verification for fifteen minutes, and each further guess restarts that window; a successful verification clears the count.

Lifetimes are settings, not constants: `OTP_TTL_SECONDS` (default `300`, five minutes) controls how long a code stays usable, `JWT_ACCESS_EXPIRES_IN` (default `7d`) the access token, and `JWT_REFRESH_EXPIRES_IN` (default `30d`) the refresh token and the matching `refresh_tokens` row. Durations accept `s`, `m`, `h`, `d`, `w`, and `y`; there is no month unit, so a month is expressed as `30d`. Note that a one-week access token means a leaked token stays usable until it expires or the session is revoked, so keep `JWT_ACCESS_SECRET` private and prefer the shortest lifetime that still suits the client.

## `POST /api/v1/auth/register`

No authentication required. `email` and `role` are optional. Phone numbers may include a leading `+`; spaces, parentheses, and hyphens are removed.

Request:

```json
{
  "fullName": "Prince Example",
  "email": "prince@example.com",
  "role": "technician",
  "phoneNumber": "+250788123456"
}
```

Success response (`200`):

```json
{
  "message": "OTP generated. Verify it to complete registration.",
  "user": {
    "id": "generated-user-id",
    "fullName": "Prince Example",
    "phoneNumber": "+250788123456",
    "role": "TECHNICIAN"
  }
}
```

## `POST /api/v1/auth/login`

No authentication required. The phone number must belong to an active account.

Request:

```json
{
  "phoneNumber": "+250788123456"
}
```

Success response (`200`):

```json
{
  "message": "OTP generated. It expires in 5 minutes."
}
```

Find the generated six-digit code in the API terminal during development.

## `POST /api/v1/auth/resend-otp`

No authentication required. Requires a registered phone number with a pending OTP. It can be called at most three times for that OTP.

Request:

```json
{
  "phoneNumber": "+250788123456"
}
```

Success response (`200`, example after the first resend):

```json
{
  "message": "OTP resent. 2 resend(s) remain."
}
```

The replacement code is printed in the API terminal during development.

## `POST /api/v1/auth/verify-otp`

No authentication required. `otp` must be a six-digit string, unexpired, and not previously used.

Request:

```json
{
  "phoneNumber": "+250788123456",
  "otp": "123456"
}
```

Success response (`200`):

```json
{
  "user": {
    "id": "generated-user-id",
    "fullName": "Prince Example",
    "phoneNumber": "+250788123456",
    "role": "TECHNICIAN"
  },
  "accessToken": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>"
}
```

Use the access token as `Authorization: Bearer <accessToken>` for protected endpoints.

## `POST /api/v1/auth/logout`

Requires `Authorization: Bearer <accessToken>`. Send the corresponding refresh token; logout revokes the token and its access-token session.

Request:

```json
{
  "refreshToken": "<jwt-refresh-token>"
}
```

Success response (`200`):

```json
{
  "message": "Logged out successfully."
}
```

## `GET /api/v1/auth/me`

Requires `Authorization: Bearer <accessToken>`. Returns the authenticated account's full record, including `email`, `role`, `status`, and timestamps. No request body.

Updating the profile remains at `PATCH /api/v1/users/me`, and deleting the account at `DELETE /api/v1/users/me`.

Success response (`200`): one full user record.

## `POST /api/v1/auth/refresh`

No authentication header is required, because the access token has usually expired by the time this is called. Send the refresh token from the `verify-otp` response.

The submitted refresh token is revoked and replaced. Tokens are single-use: a refresh token that has already been exchanged returns `401`. Because a new session is created, any access token issued alongside the old refresh token stops working as soon as the refresh succeeds.

Request:

```json
{
  "refreshToken": "<jwt-refresh-token>"
}
```

Success response (`200`):

```json
{
  "user": {
    "id": "generated-user-id",
    "fullName": "Prince Example",
    "phoneNumber": "+250788123456",
    "role": "CUSTOMER"
  },
  "accessToken": "<jwt-access-token>",
  "refreshToken": "<jwt-refresh-token>"
}
```

The stored session lifetime follows `JWT_REFRESH_EXPIRES_IN` (default `30d`). Changing that setting changes how long a refresh token remains valid, so the database row and JWT are always in step.

## Common errors

Errors use this response structure; `message` may be an array for validation failures:

```json
{
  "statusCode": 404,
  "timestamp": "2026-09-30T10:00:00.000Z",
  "path": "/api/v1/auth/login",
  "message": "No account was found for this phone number."
}
```

Common status codes: `400` invalid request or missing pending OTP; `401` incorrect, expired, or invalid token; `403` inactive account or too many OTP attempts; `404` unknown phone number; `409` duplicate phone number or email; `503` Redis unavailable while handling an OTP.

Only active accounts can request login OTPs. Contact the administrator through the Contact Us page if an account is inactive. Console OTP output is development-only; configure a real SMS provider before using authentication in production.
