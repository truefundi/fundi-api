# Postman API testing guide

This guide lists the REST endpoints implemented in `src/` and provides
Postman-ready URLs and request bodies. It covers public, customer, technician,
and administrator routes.

An importable collection is available at
[`fundi-api.postman_collection.json`](./fundi-api.postman_collection.json).
Import it in Postman with **Import → File**. It creates a standalone
collection named `fundi-api`; it does not merge into an existing collection.

## Postman setup

Create a Postman environment with:

| Variable | Example value |
| --- | --- |
| `baseUrl` | `http://localhost:3000` |
| `customerToken` | Access token from phone OTP verification |
| `technicianToken` | Access token for technician routes (or a customer token when converting that account) |
| `jobId` | A job UUID returned by the API |
| `offerId` | An offer UUID returned by the API |
| `mediaId` | A media UUID returned by the API |
| `userId` | A user UUID returned by the API |
| `technicianId` | A technician profile UUID returned by the API |
| `categoryId` | A service category UUID returned by the API |
| `paymentId` | A booking payment UUID returned by the mock-payment endpoint |
| `verificationId` | A job phone-verification UUID returned by the OTP request |
| `documentId` | A technician document UUID returned by the API |

Use `{{baseUrl}}` at the start of every URL below. For JSON requests, choose
**Body → raw → JSON** and send `Content-Type: application/json`.

Phone numbers accept Rwandan mobile numbers in either local format
(`078xxxxxxx`, `079xxxxxxx`, `072xxxxxxx`, or `073xxxxxxx`) or international
format (`+25078xxxxxxx`, `+25079xxxxxxx`, `+25072xxxxxxx`, or `+25073xxxxxxx`).
Spaces, parentheses, and hyphens are ignored; accepted values are normalized to
`+250` format. Other prefixes or digit lengths are rejected. Email addresses
must use a valid email format.

For customer requests, choose **Authorization → Bearer Token** and enter
`{{customerToken}}`. For technician requests, enter `{{technicianToken}}`.
The collection's **Job Owner Jobs** folder uses `customerToken`; set it to the
access token for either a customer or technician when testing job creation.
To convert a customer account, use that customer's token for the
`technicianToken` variable on **Create my technician profile**.
Admin login sets `httpOnly` cookies; Postman normally stores and sends these
automatically for the same host. Keep using `localhost` consistently (do not
switch to `127.0.0.1`) so the cookie domain matches. Admin endpoints can also
use an administrator bearer token when one is available. A customer/technician
token must not be used for admin routes.

## Suggested test order

1. Register a customer (no registration OTP), use public technician
   registration, or convert an existing customer using the technician profile
   endpoint. Verify the registration/login OTP to obtain tokens. During
   local development with `SMS_MODE=console`, read the OTP in the API terminal.
2. Save the `accessToken` from verification as `customerToken` or
   `technicianToken`. Save the `refreshToken` if testing refresh/logout.
3. Verify a new technician's registration phone, then upload the required
   National ID document. A logged-in customer can instead create a technician
   profile on the same account. Create a service category and configure its
   booking fee before testing paid job creation.
4. Sign in as an admin and retain the cookies for admin-only routes.
5. Use response IDs in later requests in place of the environment placeholders.

## Service status and root

| Method | URL | Auth | Request body |
| --- | --- | --- | --- |
| GET | `{{baseUrl}}/` | None | None |
| GET | `{{baseUrl}}/api/v1/health` | None | None |
| GET | `{{baseUrl}}/favicon.ico` | None | None |

## Customer and technician phone authentication

Login uses SMS OTP for both roles. Customer account registration is immediate
and does not send an OTP; technician registration sends an OTP. The OTP is not
returned in the HTTP response; during local development, find it in the API
terminal.

### Register

**POST** `{{baseUrl}}/api/v1/auth/register` — no authentication.

```json
{
  "fullName": "Amina Example",
  "email": "amina@example.com",
  "role": "CUSTOMER",
  "phoneNumber": "+250788123456"
}
```

Omit `role` or set it to `CUSTOMER` for immediate customer registration. Set
`role` to `TECHNICIAN` to start technician phone verification. Verify that
registration OTP through `POST /api/v1/auth/verify-otp`; its response also
returns the tokens for the new session. Later sessions use the login OTP.
`email` and `role` are optional; registration cannot create an administrator.

### Publicly register a technician with a profile

**POST** `{{baseUrl}}/api/v1/technicians/register` — no authentication.
This creates the user and pending/offline technician profile in one request,
then sends a technician registration OTP.

```json
{
  "user": {
    "fullName": "Amina Example",
    "phoneNumber": "+250788123456",
    "email": "amina@example.com"
  },
  "profile": {
    "gender": "FEMALE",
    "nationalIdNumber": "1199080012345678",
    "baseAddress": "Kigali, Rwanda",
    "publicLocationLabel": "Kigali",
    "baseLatitude": null,
    "baseLongitude": null,
    "paymentMethod": "MOMO",
    "paymentNumber": "+250788123456",
    "serviceExperiences": [
      {
        "categoryId": "{{categoryId}}",
        "yearsOfExperience": 5
      }
    ]
  }
}
```

Email is optional. Do not send a user ID; the server creates it and rejects
duplicate email, phone, or technician ID values. Verify the OTP using
`POST {{baseUrl}}/api/v1/auth/verify-otp` with the submitted
`phoneNumber` and OTP from the API terminal. The response includes the token
for this account.

### Convert an existing customer account to technician

After authenticating as a customer, send a technician profile to
**POST** `{{baseUrl}}/api/v1/technicians/profile`. Account name, phone, and
email come from the logged-in user and must not be repeated in the body.
Successful profile creation changes that same account's role to `TECHNICIAN`.
JWT authentication reads the current role from the database, so sign in again
or use the existing token on the next request.

### Request a login OTP

**POST** `{{baseUrl}}/api/v1/auth/login` — no authentication.

```json
{
  "phoneNumber": "+250788123456"
}
```

### Resend the OTP

**POST** `{{baseUrl}}/api/v1/auth/resend-otp` — no authentication.

```json
{
  "phoneNumber": "+250788123456"
}
```

### Verify the OTP and receive tokens

**POST** `{{baseUrl}}/api/v1/auth/verify-otp` — no authentication.

```json
{
  "phoneNumber": "+250788123456",
  "otp": "123456"
}
```

Save `accessToken` for protected API requests and `refreshToken` for refresh
or logout requests.

### Get the signed-in account

**GET** `{{baseUrl}}/api/v1/auth/me` — bearer access token; no body.

### Refresh the phone-auth session

**POST** `{{baseUrl}}/api/v1/auth/refresh` — no authentication header.

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

Refresh tokens are single-use; replace the saved access and refresh tokens
with those in the response.

### Log out the phone-auth session

**POST** `{{baseUrl}}/api/v1/auth/logout` — bearer access token.

```json
{
  "refreshToken": "{{refreshToken}}"
}
```

## Administrator authentication

Admin sessions are cookie-based. For the standard flow, Postman must preserve
the `fundi_admin_2fa_challenge` cookie between login and verification, then
preserve the access and refresh cookies for subsequent admin requests.

### Start sign-in

**POST** `{{baseUrl}}/api/v1/auth/admin/login` — no authentication.

```json
{
  "email": "admin@fundi.rw",
  "password": "Fundi#Admin2026"
}
```

On the first sign-in, the response includes an authenticator enrollment
`secret` and `otpauthUri`. Generate a current six-digit TOTP with an
authenticator app before calling verification. The sample password is only an
example; use the password provisioned for your local administrator.

### Verify the authenticator code

**POST** `{{baseUrl}}/api/v1/auth/admin/2fa/verify` — send the challenge cookie
from the previous request.

```json
{
  "code": "123456"
}
```

On success, Postman stores the admin session cookies. The token values are
intentionally not returned in the JSON response.

### Get the admin identity

**GET** `{{baseUrl}}/api/v1/auth/admin/me` — admin access cookie; no body.

### Refresh the admin session

**POST** `{{baseUrl}}/api/v1/auth/admin/refresh` — admin refresh cookie; no
body.

### Log out the admin session

**POST** `{{baseUrl}}/api/v1/auth/admin/logout` — no body. This clears the
admin cookies.

### Development-only admin OTP endpoints

These are available only outside production when enabled. They return `404`
when disabled; do not use them as production sign-in endpoints.

**POST** `{{baseUrl}}/api/v1/auth/admin/dev/otp`:

```json
{
  "email": "admin@fundi.rw"
}
```

Use the `otp` in that response for:

**POST** `{{baseUrl}}/api/v1/auth/admin/dev/verify`:

```json
{
  "email": "admin@fundi.rw",
  "otp": "135790"
}
```

This verification request sets the same admin cookies as the standard
authenticator flow.

## User account endpoints

The self-service routes require the signed-in user's **bearer token**.
Administrator routes accept an administrator session cookie or an admin
bearer token.

### Update my account

**PATCH** `{{baseUrl}}/api/v1/users/me` — bearer token.

```json
{
  "fullName": "Amina N. Example",
  "phoneNumber": "+250788123457",
  "email": "amina.updated@example.com"
}
```

Send only the fields to change. This route does not change `role` or `status`.

### Delete my account

**DELETE** `{{baseUrl}}/api/v1/users/me` — bearer token; no body.

### Create a user (admin)

**POST** `{{baseUrl}}/api/v1/users` — admin authentication.

```json
{
  "fullName": "Mugabe Example",
  "phoneNumber": "+250788123456",
  "email": "mugabe@example.com",
  "role": "CUSTOMER",
  "status": "ACTIVE"
}
```

### List users (admin)

**GET** `{{baseUrl}}/api/v1/users?search=amina&role=TECHNICIAN&status=ACTIVE&page=1&limit=20`
— admin authentication; no body. All query parameters are optional.

### Search users (admin)

**GET** `{{baseUrl}}/api/v1/users/search?query=amina` — admin authentication;
no body. `query` is required.

### Find a user by email (admin)

**GET** `{{baseUrl}}/api/v1/users/by-email?email=amina%40example.com` — admin
authentication; no body.

### Get a user by ID (admin)

**GET** `{{baseUrl}}/api/v1/users/{{userId}}` — admin authentication; no
body.

### Update a user (admin)

**PATCH** `{{baseUrl}}/api/v1/users/{{userId}}` — admin authentication.

```json
{
  "fullName": "Amina Example",
  "role": "TECHNICIAN",
  "status": "ACTIVE"
}
```

### Update user status (admin)

**PATCH** `{{baseUrl}}/api/v1/users/{{userId}}/status` — admin
authentication.

```json
{
  "status": "INACTIVE"
}
```

Allowed statuses: `ACTIVE`, `INACTIVE`, `SUSPENDED`.

### Delete a user (admin)

**DELETE** `{{baseUrl}}/api/v1/users/{{userId}}` — admin authentication; no
body.

## Service category endpoints

### List active categories

**GET** `{{baseUrl}}/api/v1/catalog/categories` — public; no body.

### Search active categories

**GET** `{{baseUrl}}/api/v1/catalog/categories/search?name=plumb` — public;
no body.

### Get an active category by ID

**GET** `{{baseUrl}}/api/v1/catalog/categories/{{categoryId}}` — public; no
body.

### Create a category (admin)

**POST** `{{baseUrl}}/api/v1/catalog/categories` — admin authentication.

```json
{
  "name": "Home Repair",
  "bookingFee": 1000
}
```

### List all categories (admin)

**GET** `{{baseUrl}}/api/v1/catalog/admin/categories` — admin authentication;
no body.

### Find a category by exact name (admin)

**GET** `{{baseUrl}}/api/v1/catalog/admin/categories/by-name?name=Home%20Repair`
— admin authentication; no body.

### Get any category by ID (admin)

**GET** `{{baseUrl}}/api/v1/catalog/admin/categories/{{categoryId}}` — admin
authentication; no body.

### Update a category (admin)

**PATCH** `{{baseUrl}}/api/v1/catalog/categories/{{categoryId}}` — admin
authentication.

```json
{
  "name": "Home Maintenance",
  "isActive": true,
  "bookingFee": 1500
}
```

`bookingFee` is a positive integer in RWF. A category without a fee cannot be
used for a paid job request. At least one of `name`, `isActive`, or
`bookingFee` is required.

### Deactivate a category (admin)

**DELETE** `{{baseUrl}}/api/v1/catalog/categories/{{categoryId}}` — admin
authentication; no body.

## Technician profile and discovery endpoints

Technician profile write/read routes require a technician bearer token.
Authenticated discovery accepts a customer, technician, or admin token.
Public discovery requires no token.

### Create my technician profile

**POST** `{{baseUrl}}/api/v1/technicians/profile` — technician bearer token.

```json
{
  "fullName": "Amina Example",
  "phoneNumber": "+250788123456",
  "email": "amina@example.com",
  "gender": "FEMALE",
  "nationalIdNumber": "1199080012345678",
  "baseAddress": "Kigali, Rwanda",
  "publicLocationLabel": "Kigali, Rwanda",
  "baseLatitude": -1.95,
  "baseLongitude": 30.06,
  "paymentMethod": "MOMO",
  "paymentNumber": "+250788123456",
  "serviceExperiences": [
    {
      "categoryId": "{{categoryId}}",
      "yearsOfExperience": 5
    },
    {
      "customName": "Solar panel installation",
      "yearsOfExperience": 2
    }
  ]
}
```

Each service experience must contain either `categoryId` or `customName`, not
both. At least one experience is required.

### Get my technician profile

**GET** `{{baseUrl}}/api/v1/technicians/profile` — technician bearer token; no
body.

### Update my technician profile

**PUT** `{{baseUrl}}/api/v1/technicians/profile` — technician bearer token.
This example changes availability and replaces the service list:

```json
{
  "availabilityStatus": "OFFLINE",
  "serviceExperiences": [
    {
      "categoryId": "{{categoryId}}",
      "yearsOfExperience": 6
    }
  ]
}
```

Send only fields to change. Latitude and longitude must be supplied together.

### Change my availability

**PATCH** `{{baseUrl}}/api/v1/technicians/availability` — technician bearer
token.

```json
{
  "availabilityStatus": "OFFLINE"
}
```

A technician can set `ONLINE` only after approval and while the account is
active.

### List available technicians (authenticated)

**GET**
`{{baseUrl}}/api/v1/technicians?page=1&limit=20&category=Plumbing&query=Kigali`
— any authenticated role; no body.

### List approved technicians (authenticated)

**GET**
`{{baseUrl}}/api/v1/technicians/approved?page=1&limit=20&category=Plumbing`
— any authenticated role; no body.

### Get one available technician (authenticated)

**GET** `{{baseUrl}}/api/v1/technicians/available/{{technicianId}}` — any
authenticated role; no body.

### Get one approved technician (authenticated)

**GET** `{{baseUrl}}/api/v1/technicians/approved/{{technicianId}}` — any
authenticated role; no body.

### List technicians (public)

**GET**
`{{baseUrl}}/api/v1/public/technicians?page=1&limit=20&category=Plumbing&query=Kigali`
— no authentication; no body.

### Get a technician (public)

**GET** `{{baseUrl}}/api/v1/public/technicians/{{technicianId}}` — no
authentication; no body.

### Create a technician (admin)

**POST** `{{baseUrl}}/api/v1/admin/technicians` — admin authentication.

```json
{
  "user": {
    "fullName": "Amina Example",
    "phoneNumber": "+250788123456",
    "email": "amina@example.com"
  },
  "profile": {
    "gender": "FEMALE",
    "baseAddress": "Kigali, Rwanda",
    "publicLocationLabel": "Kigali, Rwanda",
    "baseLatitude": -1.95,
    "baseLongitude": 30.06,
    "paymentMethod": "MOMO",
    "paymentNumber": "+250788123456",
    "serviceExperiences": [
      {
        "categoryId": "{{categoryId}}",
        "yearsOfExperience": 5
      }
    ]
  }
}
```

### List technicians (admin)

**GET**
`{{baseUrl}}/api/v1/admin/technicians?page=1&limit=20&verificationStatus=PENDING&availabilityStatus=OFFLINE`
— admin authentication; no body.

### Search technicians (admin)

**GET**
`{{baseUrl}}/api/v1/admin/technicians/search?query=Kigali&verificationStatus=PENDING&page=1&limit=20`
— admin authentication; no body.

### Find technicians by linked user details (admin)

**GET**
`{{baseUrl}}/api/v1/admin/technicians/by-user?phoneNumber=%2B250788123456`
— admin authentication; no body. Supply at least one supported query filter:
`userId`, `phoneNumber`, `email`, or `fullName`.

### Get a technician profile by ID (admin)

**GET** `{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}` — admin
authentication; no body.

### Update a technician (admin)

**PATCH** `{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}` — admin
authentication.

```json
{
  "publicLocationLabel": "Kigali",
  "availabilityStatus": "OFFLINE"
}
```

### Update technician verification (admin)

**PATCH**
`{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}/verification-status`
— admin authentication.

```json
{
  "verificationStatus": "REJECTED"
}
```

To approve a technician, first satisfy the picture, accepted national ID, and
accepted TVET certificate checklist.

### Update technician availability (admin)

**PATCH**
`{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}/availability-status`
— admin authentication.

```json
{
  "availabilityStatus": "OFFLINE"
}
```

### Update the technician account status (admin)

**PATCH** `{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}/status` —
admin authentication.

```json
{
  "status": "SUSPENDED"
}
```

### Delete a technician (admin)

**DELETE** `{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}` — admin
authentication; no body.

## Technician documents and profile picture

These routes require a technician bearer token, except the admin routes at the
end of this section. Upload routes require **Body → form-data**, not raw JSON:
the API requires actual binary file contents in a field named `file`.

### Upload or replace a profile picture

**PUT** `{{baseUrl}}/api/v1/technicians/profile/picture` — technician bearer
token. In form-data add `file` as type **File** and select a JPEG, PNG, or
WebP image (maximum 5 MiB).

### Delete my profile picture

**DELETE** `{{baseUrl}}/api/v1/technicians/profile/picture` — technician
bearer token; no body.

### Get my verification checklist

**GET** `{{baseUrl}}/api/v1/technicians/profile/verification-checklist` —
technician bearer token; no body.

### Upload a national ID

**POST** `{{baseUrl}}/api/v1/technicians/profile/documents` — technician
bearer token. In form-data add:

| Key | Type | Example |
| --- | --- | --- |
| `file` | File | Select a JPEG, PNG, WebP, or PDF file (maximum 5 MiB) |
| `type` | Text | `NATIONAL_ID` |
| `title` | Text | `National ID card` |

### Upload a certificate

Use the same **POST** URL and add these form-data fields:

| Key | Type | Example |
| --- | --- | --- |
| `file` | File | Select the certificate PDF/image |
| `type` | Text | `CERTIFICATE` |
| `title` | Text | `TVET Certificate - Plumbing` |
| `certificateType` | Text | `TVET_CERTIFICATE` |
| `categoryId` | Text | `{{categoryId}}` |

Use either `categoryId` or `customCategoryName`, not both. For an uncatalogued
service, replace `categoryId` with a text field `customCategoryName`, for
example `Solar Panel Install`.

### List my documents

**GET** `{{baseUrl}}/api/v1/technicians/profile/documents` — technician
bearer token; no body.

### Download one of my documents

**GET**
`{{baseUrl}}/api/v1/technicians/profile/documents/{{documentId}}/download`
— technician bearer token; no body. The response is file bytes, not JSON.

### Delete one of my documents

**DELETE**
`{{baseUrl}}/api/v1/technicians/profile/documents/{{documentId}}` —
technician bearer token; no body. Only `SUBMITTED` or `DENIED` documents can
be deleted.

### List a technician's documents (admin)

**GET**
`{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}/documents` — admin
authentication; no body.

### Get a technician's verification checklist (admin)

**GET**
`{{baseUrl}}/api/v1/admin/technicians/{{technicianId}}/verification-checklist`
— admin authentication; no body.

### Download a technician document (admin)

**GET**
`{{baseUrl}}/api/v1/admin/technician-documents/{{documentId}}/download` —
admin authentication; no body. The response is file bytes, not JSON.

### Review a technician document (admin)

**PATCH**
`{{baseUrl}}/api/v1/admin/technician-documents/{{documentId}}/review` — admin
authentication.

```json
{
  "status": "DENIED",
  "reviewNote": "The photo is blurry. Please upload a clearer scan."
}
```

Allowed statuses are `REVIEWING`, `ACCEPTED`, and `DENIED`. Include a
`reviewNote` when denying.

## Customer jobs

Matching, phone-verification, and job-owner routes in this section accept a
customer or technician bearer token. For the Postman collection, use the
account's access token; a technician can place their own booking after paying
the category booking fee and verifying their phone for that request.

### Preview technicians before payment

**GET**
`{{baseUrl}}/api/v1/jobs/matching-technicians?serviceCategoryId={{categoryId}}&latitude=-1.9536&longitude=30.0606`
— no body. Returns matching technicians with scores. Replace the category
selector with `otherServiceName=Solar%20panel%20installation` for a custom
service. This preview does not create an offer or require payment.

#### Match using named locations

Both `POST` requests below accept one to five place names and use the customer
bearer token.

**POST** `{{baseUrl}}/api/v1/jobs/matching-technicians/geocode`

```json
{
  "serviceCategoryId": "{{categoryId}}",
  "locations": ["Kimihurura, Kigali", "Kicukiro, Kigali"]
}
```

This calls the configured geocoding provider (Nominatim by default), then
returns the normal distance/rating-aware matches for those places.

**POST** `{{baseUrl}}/api/v1/jobs/matching-technicians/by-location-name`

```json
{
  "serviceCategoryId": "{{categoryId}}",
  "locations": ["Kigali", "Kicukiro"],
  "latitude": null,
  "longitude": null
}
```

`locations` and the coordinate pair are independently optional, but at least
one location input is required; latitude and longitude must be sent together.
If the frontend always includes all fields, send `null` for unused location
names or both unused coordinates. Replace the coordinate `null` values with
numbers to include geographic matching alongside text matches.
Text labels match technician `baseAddress` and `publicLocationLabel` values,
including profiles that have no coordinates. Coordinates add distance-based
matches, and when both inputs are sent the API combines and deduplicates both
sets, returning distance where available and the matched labels in
`matchedLocations`. The endpoint does not geocode text labels. Both previews
create no job or offer.

### Request a job phone OTP

**POST** `{{baseUrl}}/api/v1/jobs/phone-verification/request` — no body.

The customer must repeat this verification for every job request. In local
development, read the code from the API terminal. Save `verificationId` from
the response.

### Verify the job phone OTP

**POST** `{{baseUrl}}/api/v1/jobs/phone-verification/verify`

```json
{
  "verificationId": "{{verificationId}}",
  "otp": "123456"
}
```

### Make a mock booking payment

**POST** `{{baseUrl}}/api/v1/payments/mock`

```json
{
  "serviceCategoryId": "{{categoryId}}",
  "phoneNumber": "+250788123456"
}
```

`phoneNumber` is optional and defaults to the customer's account phone. The
amount is read from the category's configured `bookingFee`; save the returned
`id` as `paymentId`. This development-only endpoint does not transfer money.

### Record payment data processed by a frontend

**POST** `{{baseUrl}}/api/v1/payments/processed`

```json
{
  "serviceCategoryId": "{{categoryId}}",
  "externalPaymentId": "frontend-payment-20261028-001",
  "status": "SUCCESS",
  "phoneNumber": "+250788123456",
  "amount": 1000,
  "paidAt": "2026-10-28T12:00:00.000Z"
}
```

This development/test-only route checks the category fee and required fields
but does **not** verify the external payment with a provider. The response
includes `providerVerified: false`; it is unavailable in production. Save
`id` as `paymentId`. A payment timestamp over seven days old is stored as
`EXPIRED` and cannot be used to create a job.

### Create a job

**POST** `{{baseUrl}}/api/v1/jobs` — this route requires **Body → form-data**
because it accepts file uploads. Add the following text fields and optional
files; do not use raw JSON when uploading files.

| Key | Type | Example |
| --- | --- | --- |
| `paymentId` | Text | `{{paymentId}}` |
| `phoneVerificationId` | Text | `{{verificationId}}` |
| `serviceCategoryId` | Text | `{{categoryId}}` |
| `description` | Text | `Repair a leaking kitchen tap and check the connection.` |
| `locationAddress` | Text | `Kimihurura, Kigali` |
| `latitude` | Text | `-1.9536` |
| `longitude` | Text | `30.0606` |
| `offeredAmount` | Text | `25000` |
| `priority` | Text | `HIGH` |
| `photos` | File | Optional JPEG/PNG/WebP; up to five files |
| `video` | File | Optional MP4; one file |

The `paymentId` must be a valid, unused payment for the selected category and
the `phoneVerificationId` must be verified and unused. A custom
`otherServiceName` can be used to preview matches, but cannot currently be
booked because payments require a `serviceCategoryId`.
Photo/video limits and sizes are described in [the Jobs API guide](./jobs.md).

### Propose a technician

**POST** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/requests`

```json
{
  "technicianId": "{{technicianId}}"
}
```

Choose a technician from the matching preview. One proposal may be active at
a time; after rejection or timeout, propose another technician while the
booking payment remains valid.

### Confirm agreement to work together

After the technician accepts, both the job owner and assigned technician
should independently confirm that they agree to work together. They can do so
while the job is `ASSIGNED` or `PAUSED`.

**POST** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/confirm-cooperation` —
customer or technician job-owner token.

**POST** `{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}/confirm-cooperation`
— assigned technician token.

No request body is required. The job response exposes `cooperationStatus`
(`PENDING` until both confirmations, then `CONFIRMED`) and each party's
confirmation time. When the second party confirms, the booking payment
immediately becomes `EXPIRED`; the job's current work status remains unchanged,
and the progress endpoints remain responsible for tracking and completing the
work. Until both confirm, the payment stays `PAUSED` with its remaining
validity preserved.

### List my jobs

**GET** `{{baseUrl}}/api/v1/jobs/mine` — customer or technician bearer token; no body.

### Get one of my jobs

**GET** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}` — customer or technician bearer token; no
body.

### Edit an open, unassigned job

**PATCH** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}` — customer or technician bearer token.

```json
{
  "description": "Repair the leaking kitchen tap and replace the worn washer.",
  "latitude": -1.954,
  "longitude": 30.061,
  "offeredAmount": 30000
}
```

Latitude and longitude must be sent together.

### Update customer progress

**PATCH** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/progress` — customer bearer
token.

```json
{
  "status": "IN_PROGRESS"
}
```

### Cancel a job

**POST** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/cancel`

```json
{
  "reason": "I need to change the requested service."
}
```

Cancellation is immediate. If assigned, it releases the technician and
reopens the job for reassignment while the payment's remaining validity
resumes.

### Pause or resume a job

**POST** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/pause` or
`{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/resume` — no body.

The technician must also request the same transition. Both parties must
confirm to change the job status.

### Hide a completed/cancelled job

**DELETE** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}` — no body. This hides the
job only from the customer's history; it does not permanently delete it.

### Retry job dispatch after a scheduling issue

**POST** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/retry-dispatch` — no body.
Customer-selected matching normally uses the proposal endpoint above.

### Add job media

**POST** `{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/media` — customer bearer
token. Use **Body → form-data** and add one or more `photos` file fields
and/or one `video` file field. This endpoint requires actual file contents,
so a JSON body cannot be used.

### Remove job media

**DELETE**
`{{baseUrl}}/api/v1/jobs/mine/{{jobId}}/media/{{mediaId}}` — customer
bearer token; no body.

### Download job media

**GET**
`{{baseUrl}}/api/v1/jobs/{{jobId}}/media/{{mediaId}}` — job owner, assigned
technician, or admin authentication; no body. Returns file bytes.

## Technician jobs

All routes in this section require a technician bearer token.

### List job offers

**GET** `{{baseUrl}}/api/v1/jobs/technician/offers` — no body.

### Accept an offer

**POST** `{{baseUrl}}/api/v1/jobs/technician/offers/{{offerId}}/accept` — no
body.

### Reject an offer

**POST** `{{baseUrl}}/api/v1/jobs/technician/offers/{{offerId}}/reject`

```json
{
  "reason": "I am unavailable at that time."
}
```

The `reason` field is optional.

### List my assigned jobs

**GET** `{{baseUrl}}/api/v1/jobs/technician/mine` — no body.

### Get one assigned job

**GET** `{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}` — no body.

### Confirm agreement to work together

**POST**
`{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}/confirm-cooperation` —
no body. The booking payment expires when the job owner also confirms.

### Update technician progress

**PATCH**
`{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}/progress`

```json
{
  "status": "COMPLETED"
}
```

### Drop an assigned job

**POST** `{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}/drop`

```json
{
  "reason": "My vehicle broke down and I cannot reach the location."
}
```

This submits a cancellation request for administrator review; the technician
remains assigned until an administrator approves it.

### Pause or resume a job

**POST** `{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}/pause` or
`{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}/resume` — no body. The
customer must also request the same transition.

### Hide a completed/cancelled job

**DELETE** `{{baseUrl}}/api/v1/jobs/technician/mine/{{jobId}}` — no body.
Hides the job from this technician's history only.

## Administrator dashboard and jobs

These routes require administrator authentication.

### Get dashboard account statistics

**GET** `{{baseUrl}}/api/v1/admin/stats` — no body.

### List all jobs

**GET** `{{baseUrl}}/api/v1/admin/jobs` — no body.

### Get job summary

**GET** `{{baseUrl}}/api/v1/admin/jobs/summary` — no body.

### Get a job by ID

**GET** `{{baseUrl}}/api/v1/admin/jobs/{{jobId}}` — no body.

### Review technician cancellation requests

**GET** `{{baseUrl}}/api/v1/admin/jobs/cancellation-requests` — no body.

**PATCH**
`{{baseUrl}}/api/v1/admin/jobs/cancellation-requests/{{requestId}}`

```json
{
  "decision": "APPROVE",
  "reviewNote": "Cancellation approved."
}
```

Use `REJECT` to keep the current assignment in place. Approval releases the
technician and resumes remaining payment validity.

### Update or permanently delete a job

**PATCH** `{{baseUrl}}/api/v1/admin/jobs/{{jobId}}`

```json
{
  "description": "Updated job description with the agreed repair details.",
  "locationAddress": "Kacyiru, Kigali",
  "offeredAmount": 30000
}
```

Admins can permanently delete a job only when it is completed or cancelled.
User `DELETE` endpoints only hide the job from that user's history.

## Booking payment history

### List my payments

**GET** `{{baseUrl}}/api/v1/payments/mine` — customer or technician bearer token; no body.
The response includes service, status, payment amount, associated job, and
technicians involved.

### List all payments (admin)

**GET** `{{baseUrl}}/api/v1/admin/payments` — admin authentication; no body.

### Extend payment validity (admin)

**PATCH**
`{{baseUrl}}/api/v1/admin/payments/{{paymentId}}/extend`

```json
{
  "days": 7
}
```

`days` must be an integer from 1 to 30. Completed payments cannot be extended.

### Completed-job payment CRUD (admin)

These routes manage only payment records whose associated jobs are completed.
An administrator can list or read them:

- **GET** `{{baseUrl}}/api/v1/admin/payments/completed`
- **GET** `{{baseUrl}}/api/v1/admin/payments/completed/{{paymentId}}`

Create a reconciliation record for a completed job that does not already have
a payment:

**POST** `{{baseUrl}}/api/v1/admin/payments/completed`

```json
{
  "jobId": "{{jobId}}",
  "externalPaymentId": "reconciled-payment-001",
  "phoneNumber": "+250788123456",
  "paidAt": "2026-10-28T12:00:00.000Z"
}
```

The amount and customer are derived from the completed job and category.
Update a record with **PATCH**
`{{baseUrl}}/api/v1/admin/payments/completed/{{paymentId}}`:

```json
{
  "externalPaymentId": "corrected-provider-reference",
  "phoneNumber": "+250788123456"
}
```

Delete with **DELETE**
`{{baseUrl}}/api/v1/admin/payments/completed/{{paymentId}}`. Deletion keeps an
audit snapshot of the payment data.

## API documentation and behavior notes

- The API's interactive Swagger page is at `{{baseUrl}}/api/docs`.
- Most malformed inputs return `400`; missing/invalid authentication returns
  `401`; a valid account with the wrong role returns `403`; missing records
  return `404`; conflicting or disallowed state changes may return `409`.
- Request/response field rules and response examples are documented in the
  dedicated [authentication](./authentication.md), [administrator
  authentication](./admin-authentication.md), [user management](./users.md),
  [technician onboarding](./technician-onboarding.md), [technician
  documents](./technician-documents.md), [service categories](./service-categories.md),
  [jobs](./jobs.md), and [booking payments](./booking-payments.md) guides.
