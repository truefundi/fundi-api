# Admin Authentication API

An administrator supplies an email address and a password, then a six-digit code sent to the phone number on the account. The password step alone grants nothing: no access cookie exists until the second factor is verified, so every protected route answers `401` for a half-finished sign-in. There is no partial token that could be replayed.

This is a separate flow from [phone authentication](authentication.md), where customers and technicians receive bearer tokens they hold themselves. An administrator never handles a token at all: the session lives entirely in `httpOnly` cookies that no script on the page can read.

Only the provisioning script can set an administrator's password. No route writes `passwordHash`, so the password that makes an account able to sign in here is reachable only by `npm run prisma:seed-admin`. An administrator row created through `POST /api/v1/users`, or promoted later through `PATCH /api/v1/users/:id`, has no password and cannot complete sign-in until the script has run for it.

The password step deliberately reveals nothing: a wrong password, an unknown address, a non-administrator, a disabled account, and an account with no password set all return `401` with the identical message `Invalid email or password.`. An unknown address is also compared against a dummy hash so the response takes about as long as a real one, which stops timing from disclosing whether an address exists.

Only one code is live per administrator. Starting a new sign-in discards any earlier challenge, so an old code cannot be used after a new one is sent. A code can be resent at most `ADMIN_2FA_MAX_RESENDS` times (default 3), and incorrect codes are counted per account rather than per code, so resending does not reset the count.

## `POST /api/v1/auth/admin/login`

No authentication required. This is step one of two. `email` is trimmed and lowercased, so surrounding whitespace and capitalisation do not matter. `password` must be at least 8 characters and contain at least one uppercase letter, one number, and one non-alphanumeric character.

Request:

```json
{
  "email": "admin@fundi.rw",
  "password": "Fundi#Admin2026"
}
```

Success response (`200`) — note the absence of any token:

```json
{
  "message": "Verification code sent. It expires in 5 minutes.",
  "maskedPhoneNumber": "+250******123",
  "expiresInSeconds": 300
}
```

Sets `fundi_admin_2fa_challenge`. Find the generated six-digit code in the API terminal during development. Any extra property in the body is rejected, so a challenge id cannot be supplied here to aim a later verification at somebody else's.

## `POST /api/v1/auth/admin/2fa/resend`

No authentication required. Requires the challenge cookie. Replaces the pending code and extends the challenge; it does not reset the incorrect-code count.

Success response (`200`):

```json
{
  "message": "A new verification code has been sent."
}
```

## `POST /api/v1/auth/admin/2fa/verify`

No authentication required. Requires the challenge cookie. This is the only endpoint that issues a session. A correct code is consumed and cannot be reused.

Request:

```json
{
  "code": "123456"
}
```

Success response (`200`) — the tokens are set as cookies and are absent from the body:

```json
{
  "user": {
    "id": "generated-admin-id",
    "fullName": "Alice Mukamana",
    "email": "admin@fundi.rw",
    "role": "ADMIN"
  },
  "expiresInSeconds": 900
}
```

Sets `fundi_admin_access` and `fundi_admin_refresh`, and clears the challenge cookie.

## `POST /api/v1/auth/admin/refresh`

No authentication header and no body. Normally called after the short-lived access token has expired. The presented cookie is single use and is revoked as the new pair is issued. Returns the same shape as `2fa/verify`.

## `POST /api/v1/auth/admin/logout`

No authentication header and no body, so signing out still works once the access cookie has expired. Revokes the stored session when the refresh cookie is present, and always clears all three cookies. Returns `200` even when no session exists, so the dashboard can never be left holding a session it cannot drop.

## `GET /api/v1/auth/admin/me`

Requires the admin session cookies. Answers `401` until `2fa/verify` has completed. Returns only the identity fields; the password hash is never returned.

Success response (`200`):

```json
{
  "id": "generated-admin-id",
  "fullName": "Alice Mukamana",
  "email": "admin@fundi.rw",
  "role": "ADMIN"
}
```

## Creating an administrator

Set the values below and run `npm run prisma:seed-admin`. Re-running it resets the password of an existing administrator rather than creating a duplicate. It refuses to promote an account that already exists with a different role, so an address reused by mistake cannot silently gain administrator rights.

| Variable | Meaning |
| --- | --- |
| `ADMIN_EMAIL` | Login address. Trimmed and lowercased. |
| `ADMIN_PASSWORD` | Must satisfy the same strength rules the login endpoint enforces. Read from the environment rather than a command-line argument so it stays out of shell history. Not trimmed: leading and trailing spaces are part of the password. |
| `ADMIN_FULL_NAME` | Display name. |
| `ADMIN_PHONE_NUMBER` | Where the second-factor code is sent. Must be unique. |

The password is checked against the same rules the login endpoint enforces, so an administrator cannot be created with a password the API would later reject. There is no password-change or reset route yet; a lost admin password has to be repaired by re-running the script or in the database directly.

A row with the `ADMIN` role can also be produced through `POST /api/v1/users` or `PATCH /api/v1/users/:id`, both of which need an administrator session already. That yields an account with no password, which cannot sign in here: it fails with `Invalid email or password.` until the script has been run for it. This is deliberate, so a compromised admin session can create an administrator row but cannot make it usable without the provisioning environment.

## Cookies and the browser

Three cookies are set, all `httpOnly`, so injected script cannot read them and a cross-site scripting bug does not hand over the session:

| Cookie | Purpose | Path |
| --- | --- | --- |
| `fundi_admin_2fa_challenge` | Opaque id of the pending code. Grants nothing by itself. | `/api/v1/auth/admin/2fa` |
| `fundi_admin_access` | Short-lived access JWT. | `/` |
| `fundi_admin_refresh` | Single-use refresh JWT. | `/` |

The session cookies are explicitly scoped to `/`. Left unset, a browser scopes a cookie to the directory of the request that created it, which here would hide it from `/api/v1/users` and break the dashboard without any visible error.

Tokens are never returned in a response body, so the dashboard has nothing to store in `localStorage` and nothing to leak through a `document.cookie` read. `GET /api/v1/auth/admin/me` is the intended way to find out whether a session is live.

The dashboard must send `credentials: 'include'` (or `withCredentials` in XHR), and `CORS_ORIGINS` must list the dashboard origin explicitly. A wildcard `*` does not work with credentialed requests, and browsers reject it. Because cookies are cross-origin, the API must also be served over HTTPS in production; `ADMIN_COOKIE_SECURE` defaults to true when `NODE_ENV=production`.

**Known limitation.** These cookies rely on `SameSite=Lax` alone for cross-site request protection. There is no CSRF token. `Lax` blocks cross-site `POST` requests from carrying cookies, which covers the state-changing endpoints here, but any future state-changing `GET` would not be protected. Set `ADMIN_COOKIE_SAME_SITE=none` only when the dashboard is genuinely on another site, and keep `ADMIN_COOKIE_SECURE=true`, which browsers require alongside it.

Two further restrictions exist because cookies travel automatically. `PATCH` and `DELETE /api/v1/users/me` accept a bearer token only, so a stolen dashboard session cannot quietly redirect the second factor to a different number. `POST /api/v1/auth/admin/logout` takes no access token on purpose, so signing out still works once the access cookie has expired.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_BCRYPT_ROUNDS` | `12` | Password hashing work factor. |
| `ADMIN_MAX_LOGIN_ATTEMPTS` | `5` | Wrong passwords before lockout. |
| `ADMIN_LOGIN_LOCKOUT_SECONDS` | `900` | Lockout window. A correct password is refused during it. |
| `ADMIN_2FA_TTL_SECONDS` | `300` | Lifetime of the code. |
| `ADMIN_2FA_MAX_RESENDS` | `3` | Resends allowed per challenge. |
| `ADMIN_2FA_MAX_TRIES` | `5` | Incorrect codes allowed per account. |
| `ADMIN_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime. |
| `ADMIN_REFRESH_EXPIRES_IN` | `12h` | Refresh token and matching database row. |
| `ADMIN_COOKIE_SAME_SITE` | `lax` | Cookie `SameSite` flag. |
| `ADMIN_COOKIE_SECURE` | `true` in production | Cookie `Secure` flag. |
| `ADMIN_COOKIE_DOMAIN` | unset | Cookie domain. Leave unset to keep cookies host-only. |

These lifetimes are deliberately shorter than the phone defaults in [authentication.md](authentication.md) (`7d` access, `30d` refresh), because a dashboard session is worth more if stolen and is easier to end.

## Common errors

Errors use the same structure as every other endpoint; `message` may be an array for validation failures:

```json
{
  "statusCode": 401,
  "timestamp": "2026-10-03T10:32:26.136Z",
  "path": "/api/v1/auth/admin/login",
  "message": "Invalid email or password."
}
```

`400` invalid request, or there is no pending verification to resend or submit against; `401` the shared message for every rejected credential, or an incorrect or expired code; `403` too many incorrect codes, or the account is no longer an active administrator; `429` the address is locked out after too many wrong passwords, or the account submitted too many incorrect codes; `503` the SMS could not be sent, or the rate-limit store is unreachable.

A Redis outage is deliberately reported as `503` rather than as a rejected password, so a fault is never mistaken for a bad credential. Console OTP output is development-only; configure a real SMS provider before using this flow in production.
