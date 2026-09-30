# Phone Authentication API

Phone numbers are the login identifier. Public registration accepts `CUSTOMER` or `TECHNICIAN` (case-insensitive) and defaults to `CUSTOMER`; it cannot create an administrator. New accounts default to `ACTIVE`.

Send `Content-Type: application/json` for requests with a body. OTP hashes and resend/verification counters are stored temporarily in Redis, where the OTP key expires automatically after 60 seconds; PostgreSQL stores user and refresh-token data, not OTPs. During development, `SMS_MODE=console` prints OTP codes in the backend terminal, not in the HTTP response. OTPs can be resent at most three times and are rejected after five incorrect attempts.

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
  "message": "OTP generated. It expires in one minute."
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

Common status codes: `400` invalid request or missing pending OTP; `401` incorrect, expired, or invalid token; `403` inactive account or too many OTP attempts; `404` unknown phone number; `409` duplicate phone number or email.

Only active accounts can request login OTPs. Contact the administrator through the Contact Us page if an account is inactive. Console OTP output is development-only; configure a real SMS provider before using authentication in production.
