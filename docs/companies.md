# Technician Companies and Role Switching

All routes are prefixed with `/api/v1`. Owner routes require a customer or
technician bearer token. Administrator routes require an administrator
session/token. Company fields are available from the company endpoints and are
not duplicated in technician profile responses.

## Technician registration with a company

When creating a technician profile with `POST /api/v1/technicians/profile`,
include `businessType: "COMPANY"` and a nested `company` object to register a
company owned by that technician. `businessType` defaults to `INDIVIDUAL`.
For a company owner, `name`, `location`, `email`, and `phoneNumber` are
required; `description` is optional.

```json
{
  "gender": "FEMALE",
  "nationalIdNumber": "1199080012345678",
  "baseAddress": "Kigali, Rwanda",
  "paymentMethod": "MOMO",
  "paymentNumber": "+250788123456",
  "serviceExperiences": [
    { "categoryId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100", "yearsOfExperience": 5 }
  ],
  "businessType": "COMPANY",
  "company": {
    "name": "Amina Plumbing Ltd",
    "location": "Kigali, Rwanda",
    "email": "amina@example.com",
    "phoneNumber": "+250788123456",
    "description": "Residential plumbing services"
  }
}
```

The company is created in the same transaction as the technician profile and
starts with `verificationStatus: "PENDING"`. One company may be associated
with each technician profile. If company details are omitted, the technician
is registered as an individual.

## Company owner endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/companies/mine` | Read the signed-in user's company |
| `PATCH` | `/api/v1/companies/mine` | Update company details before approval |

Owners can update `name`, `location`, `email`, `phoneNumber`, and/or
`description`. At least one field is required. Any owner edit before approval
returns the company to `PENDING` and clears its previous verification
metadata. Once approved, owner edits are rejected; an administrator must
change the company instead.

## Administrator company management

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/companies?verificationStatus=PENDING` | List companies, optionally filtered by status |
| `POST` | `/api/v1/admin/companies` | Create a company for an existing technician profile |
| `GET` | `/api/v1/admin/companies/:id` | Read one company |
| `PATCH` | `/api/v1/admin/companies/:id` | Update company fields |
| `PATCH` | `/api/v1/admin/companies/:id/verification-status` | Approve or reject a company |
| `DELETE` | `/api/v1/admin/companies/:id` | Delete a company |

Admin create request:

```json
{
  "technicianId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
  "name": "Amina Plumbing Ltd",
  "location": "Kigali, Rwanda",
  "email": "amina@example.com",
  "phoneNumber": "+250788123456",
  "description": "Residential plumbing services"
}
```

Verification request:

```json
{
  "verificationStatus": "APPROVED"
}
```

The status must be `PENDING`, `APPROVED`, or `REJECTED`. Approval records the
admin verifier and timestamp. Company creation, updates, verification changes,
and deletion are audited. Deleting the company resets the owning technician's
`businessType` to `INDIVIDUAL`.

## Technician eligibility and role changes

### `GET /api/v1/users/me/technician-eligibility`

Returns the current user's technician-registration and approval state:

```json
{
  "role": "CUSTOMER",
  "technicianRegistered": true,
  "technicianVerificationStatus": "PENDING",
  "technicianApproved": false,
  "canSwitchToTechnician": false
}
```

An unregistered customer can apply through
`POST /api/v1/technicians/profile`. A customer remains in customer mode while
the application is pending or rejected; they can read, update, and upload
documents for their own profile while signed in as a customer. A customer can
switch to technician mode only once the profile is approved.

### `PATCH /api/v1/users/me/role`

Request:

```json
{ "role": "TECHNICIAN" }
```

Only `CUSTOMER` and `TECHNICIAN` are valid target roles. Switching to
`TECHNICIAN` requires an approved profile. Switching to `CUSTOMER` is blocked
while the user has any technician job in `ASSIGNED` or `PAUSED` status.
Success response:

```json
{ "role": "TECHNICIAN", "changed": true }
```

The existing `POST /api/v1/jobs` and `POST /api/v1/jobs/sos` endpoints accept
both `CUSTOMER` and `TECHNICIAN` roles. There is no separate job-creation
endpoint needed when a user changes modes.
