# Technician Draft Profile API

Day 2 delivers the technician's resumable onboarding draft. This profile is separate from the user's login status: the profile starts with `verificationStatus: DRAFT`, while the user account must be active to authenticate. Only accounts with the `TECHNICIAN` role can call these endpoints.

Use `Authorization: Bearer <technician-access-token>` and `Content-Type: application/json` for updates. Each field in the update body is optional so the client can save one wizard step at a time. Profile and progress are stored in PostgreSQL and returned on later requests.

## `GET /api/v1/technicians/profile`

Returns the saved draft. If the technician has not opened onboarding before, the endpoint creates an empty draft profile. No request body.

Success response (`200`):

```json
{
  "id": "generated-profile-id",
  "user": {
    "id": "generated-user-id",
    "fullName": "Amina Example",
    "phoneNumber": "+250788123456",
    "email": null
  },
  "verificationStatus": "DRAFT",
  "onboardingStep": 1,
  "yearsOfExperience": null,
  "tin": null,
  "categories": [],
  "location": {
    "address": null,
    "latitude": null,
    "longitude": null,
    "serviceRadiusKm": null
  },
  "createdAt": "2026-10-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T10:00:00.000Z"
}
```

## `PUT /api/v1/technicians/profile`

Saves only the fields sent. Fields may be saved over multiple requests. `email` can be `null` to clear it. `categoryIds` replaces the selected categories; send `[]` to clear them. Every selected ID must refer to an active service category. `baseLatitude` and `baseLongitude` are stored independently so location can also be completed progressively.

Request:

```json
{
  "email": "amina@example.com",
  "yearsOfExperience": 5,
  "tin": "TIN-123456",
  "categoryIds": ["e5a4f4d7-0b21-46d8-9a4b-98765d332100"],
  "baseAddress": "Kigali, Rwanda",
  "baseLatitude": -1.95,
  "baseLongitude": 30.06,
  "serviceRadiusKm": 20,
  "onboardingStep": 3
}
```

Success response (`200`): the full saved draft profile, with the selected categories returned as objects containing `id`, `name`, and `slug`.

A profile update is saved with an audit record containing the changed field names, not their submitted values.

## Validation and errors

- `400`: no fields supplied, invalid field values, or one or more category IDs do not identify active categories.
- `401`: missing or invalid access token.
- `403`: caller is not a technician or the account is inactive.
- `409`: email address is already used by another account.

Document uploads, payout details, and submission for administrator review are not part of this draft-profile phase; they are planned for the next onboarding milestone.
