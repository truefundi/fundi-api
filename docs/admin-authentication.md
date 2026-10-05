# Admin Authentication API

An administrator supplies an email address and a password, then a six-digit code from an authenticator app (Google Authenticator, Authy, 1Password, and anything else speaking the standard `otpauth://` format). The password step alone grants nothing: no access cookie exists until the second factor is verified, so every protected route answers `401` for a half-finished sign-in. There is no partial token that could be replayed.

The second factor is a time-based one-time password computed on the administrator's own device. Nothing is sent anywhere: there is no SMS provider to configure, no code to intercept in transit, and no `2fa/resend` endpoint, because there is nothing to resend.

This is a separate flow from [phone authentication](authentication.md), where customers and technicians receive bearer tokens they hold themselves. An administrator never handles a token at all: the session lives entirely in `httpOnly` cookies that no script on the page can read.

Only the provisioning script can set an administrator's password. No route writes `passwordHash`, so the password that makes an account able to sign in here is reachable only by `npm run prisma:seed-admin`. An administrator row created through `POST /api/v1/users`, or promoted later through `PATCH /api/v1/users/:id`, has no password and cannot complete sign-in until the script has run for it.

The password step deliberately reveals nothing: a wrong password, an unknown address, a non-administrator, a disabled account, and an account with no password set all return `401` with the identical message `Invalid email or password.`. An unknown address is also compared against a dummy hash so the response takes about as long as a real one, which stops timing from disclosing whether an address exists.

## Enrolment

The authenticator is set up on the account's first sign-in, so there is no separate enrolment step to remember before anyone can sign in.

That first sign-in behaves differently from every later one. `/login` returns `enrollmentRequired: true` along with an `otpauthUri` and a `secret`, and the dashboard renders the URI as a QR code. Nothing is written to the database yet. Only when `/2fa/verify` accepts a first code does the secret get encrypted onto the account and the factor become usable.

This ordering is what keeps a half-finished setup recoverable. Because the secret is generated per sign-in rather than per account, an administrator who scans the wrong QR code, or walks away from the screen, simply signs in again and gets a new one — the abandoned secret was never stored and there is nothing to clean up. Signing in again after enrolling behaves like any other sign-in: the code comes from the app, and nothing new is issued.

The shared secret is held in Redis in the clear for the length of the enrolment window, and only ever written to the database encrypted. It cannot be hashed: the server has to read it back to compute the code it expects, so a one-way hash would make verification impossible.

**No recovery path exists yet.** There are no backup codes and no reset route. If an administrator loses access to their authenticator, the way back is a direct `UPDATE "users" SET "totpSecret" = NULL, "totpEnabledAt" = NULL` against the database, after which their next sign-in starts a fresh enrolment. This is a known gap and must be closed before launch.

Codes are accepted one step either side of the current one (`ADMIN_TOTP_WINDOW`, default 1), which absorbs ordinary clock skew between the server and the phone. Both sides need reasonable time: a host that has drifted by minutes, or a phone whose clock has drifted, will produce codes that are rejected.

Only one challenge is live per administrator. Starting a new sign-in discards any earlier one. Incorrect codes are counted per account rather than per challenge, so signing in again does not reset the count — and the budget matters more here than it did over SMS, because a TOTP code is six digits and live for 30 seconds.

## `POST /api/v1/auth/admin/login`

No authentication required. This is step one of two. `email` is trimmed and lowercased, so surrounding whitespace and capitalisation do not matter. `password` must be at least 8 characters and contain at least one uppercase letter, one number, and one non-alphanumeric character.

Request:

```json
{
  "email": "admin@fundi.rw",
  "password": "Fundi#Admin2026"
}
```

Success response (`200`) on the **first** sign-in — note the absence of any token:

```json
{
  "message": "Scan this with your authenticator app, then enter the 6-digit code it shows. If you cannot scan, enter the secret by hand.",
  "enrollmentRequired": true,
  "expiresInSeconds": 300,
  "otpauthUri": "otpauth://totp/Fundi:admin%40fundi.rw?secret=KZWROMS4EYNUOSAQKZWROMS4EYNUOSAQ&period=30&digits=6&algorithm=SHA1&issuer=Fundi",
  "secret": "KZWROMS4EYNUOSAQKZWROMS4EYNUOSAQ"
}
```

Success response (`200`) on **every later** sign-in:

```json
{
  "message": "Enter the 6-digit code from your authenticator app.",
  "enrollmentRequired": false,
  "expiresInSeconds": 300
}
```

Set `enrollmentRequired` to decide what the dashboard shows: a QR code plus a manual-entry field, or a single code input.

Sets `fundi_admin_2fa_challenge` in both cases. `otpauthUri` is what the dashboard renders as a QR code — no image is generated here, so no QR library is needed on the backend. The `secret` is the same shared secret in plain base32, for anyone who cannot scan. Both are sent with `Cache-Control: no-store`, because the QR image *is* the secret in plaintext and a cached copy would hand it to anyone who could read the cache.

The `otpauth://` issuer has to match in both the label and the query parameter or authenticator apps reject the scan; `ADMIN_TOTP_ISSUER` is used for both, and the two are asserted in the tests.

Any extra property in the body is rejected, so a challenge id cannot be supplied here to aim a later verification at somebody else's.

There is no `POST /api/v1/auth/admin/2fa/resend`. An authenticator produces codes locally and continuously, so there is nothing to send again.

## `POST /api/v1/auth/admin/2fa/verify`

No authentication required. Requires the challenge cookie. This is the only endpoint that issues a session.

A correct code is consumed and cannot be reused. On the first sign-in this same request also confirms the enrolment, which is what writes the secret to the account — so `enrollmentRequired: true` and `false` are verified through the identical endpoint.

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
| `ADMIN_PHONE_NUMBER` | Contact number. Must be unique. Still required by the schema, but no longer used for the second factor — the authenticator is. |

The password is checked against the same rules the login endpoint enforces, so an administrator cannot be created with a password the API would later reject. There is no password-change or reset route yet; a lost admin password has to be repaired by re-running the script or in the database directly.

A row with the `ADMIN` role can also be produced through `POST /api/v1/users` or `PATCH /api/v1/users/:id`, both of which need an administrator session already. That yields an account with no password, which cannot sign in here: it fails with `Invalid email or password.` until the script has been run for it. This is deliberate, so a compromised admin session can create an administrator row but cannot make it usable without the provisioning environment.

## Cookies and the browser

Three cookies are set, all `httpOnly`, so injected script cannot read them and a cross-site scripting bug does not hand over the session:

| Cookie | Purpose | Path |
| --- | --- | --- |
| `fundi_admin_2fa_challenge` | Opaque id of the pending challenge. Grants nothing by itself. | `/api/v1/auth/admin/2fa` |
| `fundi_admin_access` | Short-lived access JWT. | `/` |
| `fundi_admin_refresh` | Single-use refresh JWT. | `/` |

The session cookies are explicitly scoped to `/`. Left unset, a browser scopes a cookie to the directory of the request that created it, which here would hide it from `/api/v1/users` and break the dashboard without any visible error.

Tokens are never returned in a response body, so the dashboard has nothing to store in `localStorage` and nothing to leak through a `document.cookie` read. `GET /api/v1/auth/admin/me` is the intended way to find out whether a session is live.

The dashboard must send `credentials: 'include'` (or `withCredentials` in XHR), and `CORS_ORIGINS` must list the dashboard origin explicitly. A wildcard `*` does not work with credentialed requests, and browsers reject it. Because cookies are cross-origin, the API must also be served over HTTPS in production; `ADMIN_COOKIE_SECURE` defaults to true when `NODE_ENV=production`.

**Known limitation.** These cookies rely on `SameSite=Lax` alone for cross-site request protection. There is no CSRF token. `Lax` blocks cross-site `POST` requests from carrying cookies, which covers the state-changing endpoints here, but any future state-changing `GET` would not be protected. Set `ADMIN_COOKIE_SAME_SITE=none` only when the dashboard is genuinely on another site, and keep `ADMIN_COOKIE_SECURE=true`, which browsers require alongside it.

Two further restrictions exist because cookies travel automatically. `PATCH` and `DELETE /api/v1/users/me` accept a bearer token only, so a stolen dashboard session cannot quietly change the account details an administrator signs in with. `POST /api/v1/auth/admin/logout` takes no access token on purpose, so signing out still works once the access cookie has expired.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_BCRYPT_ROUNDS` | `12` | Password hashing work factor. |
| `ADMIN_MAX_LOGIN_ATTEMPTS` | `5` | Wrong passwords before lockout. |
| `ADMIN_LOGIN_LOCKOUT_SECONDS` | `900` | Lockout window. A correct password is refused during it. |
| `ADMIN_2FA_PENDING_SECONDS` | `300` | How long a password-verified sign-in stays open waiting for a code. Not a code lifetime — it only bounds an abandoned sign-in. |
| `ADMIN_2FA_MAX_TRIES` | `5` | Incorrect codes allowed per account, on a sliding 15-minute window. |
| `ADMIN_TOTP_ISSUER` | `Fundi` | Label shown in the app. Must match in both the `otpauth://` label and its query parameter. |
| `ADMIN_TOTP_WINDOW` | `1` | Clock-drift tolerance in 30-second steps either side. |
| `ADMIN_TOTP_ENCRYPTION_KEY` | none | 64 hex characters. Encrypts the authenticator secret at rest. Sign-in fails with `503` until set. |
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

`400` invalid request, or there is no pending verification to submit against (including one already spent); `401` the shared message for every rejected credential, an incorrect code, or a sign-in window that has closed; `403` the account is no longer an active administrator; `429` the address is locked out after too many wrong passwords, or the account submitted too many incorrect codes; `503` the rate-limit store is unreachable, or `ADMIN_TOTP_ENCRYPTION_KEY` is unset.

Note that `429` is used for a caller being slowed down, not refused, and is documented as such in Swagger — the decorator is `ApiTooManyRequests`.

A Redis outage is deliberately reported as `503` rather than as a rejected password, so a fault is never mistaken for a bad credential. An unset or wrong `ADMIN_TOTP_ENCRYPTION_KEY` likewise reports `503` and names the setting, because an administrator who cannot be verified because of a misconfiguration must not be told their code was wrong.
