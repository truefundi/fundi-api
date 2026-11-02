# Service Categories API

The service catalog powers customer service discovery and technician category selection. Public clients can read active categories; only administrators can create, edit, deactivate, or inspect inactive categories. Administrators set each category's description, dashboard grouping, and positive `visitFee`/`emergencyVisitFee` in RWF. A category without a configured fee cannot be used to create a paid job request. Send `Content-Type: application/json` for requests with a body.

For local development, seed the initial sample catalog with `npm run prisma:seed`. The seed operation is safe to rerun because it upserts categories by slug.

## Public endpoints

### `GET /api/v1/catalog/categories`

No authentication or request body required. Lists all active categories.

Success response (`200`):

```json
[
  {
    "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
    "name": "Plumbing",
    "slug": "plumbing",
    "description": "Leak repairs, pipe fitting, and drain unblocking.",
    "category": "Home Services",
    "visitFee": 1000,
    "emergencyVisitFee": 1500
  }
]
```

### `GET /api/v1/catalog/categories/:id`

Replace `:id` with a category UUID. No request body or authentication required. Inactive categories are hidden from public clients.

Success response (`200`):

```json
{
  "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
  "name": "Plumbing",
  "slug": "plumbing",
  "description": "Leak repairs, pipe fitting, and drain unblocking.",
  "category": "Home Services",
  "visitFee": 1000,
  "emergencyVisitFee": 1500
}
```

### `GET /api/v1/catalog/categories/search?name=plumb`

The `name` query parameter is required. Returns active categories whose names contain the query, case-insensitively. No request body or authentication required. The response is an array in the same format as the list endpoint.

## Administrator endpoints

All administrator endpoints require `Authorization: Bearer <admin-access-token>`.

### `POST /api/v1/catalog/categories`

Creates a category. The name is trimmed; a URL-friendly slug is generated automatically. `category` groups the service in the dashboard, and both fees are non-negative integers in RWF.

Request:

```json
{
  "name": "Home Repair",
  "category": "Home Services",
  "description": "General household repairs.",
  "visitFee": 1000,
  "emergencyVisitFee": 1500
}
```

Success response (`201`):

```json
{
  "id": "generated-category-id",
  "name": "Home Repair",
  "slug": "home-repair",
  "description": "General household repairs.",
  "category": "Home Services",
  "visitFee": 1000,
  "emergencyVisitFee": 1500,
  "isActive": true,
  "createdAt": "2026-10-01T10:00:00.000Z"
}
```

### `GET /api/v1/catalog/admin/categories`

Lists active and inactive categories. No request body.

Success response (`200`): an array of full category records.

### `GET /api/v1/catalog/admin/categories/:id`

Gets any category, including inactive categories, by UUID. No request body.

Success response (`200`): one full category record.

### `GET /api/v1/catalog/admin/categories/by-name?name=Home%20Repair`

Finds a category by exact name, case-insensitively. No request body.

Success response (`200`): one full category record.

### `PATCH /api/v1/catalog/categories/:id`

Update a category name, description, dashboard grouping, availability, or fees. At least one field is required. `visitFee` and `emergencyVisitFee` must be non-negative integers in RWF. Changing the name also regenerates its slug.

Request:

```json
{
  "name": "Home Maintenance",
  "isActive": true,
  "visitFee": 1500,
  "emergencyVisitFee": 2000
}
```

Success response (`200`): the updated full category record.

### `DELETE /api/v1/catalog/categories/:id`

Deactivates a category rather than physically deleting it, preserving existing references from technician profiles and jobs. No request body.

Success response (`200`):

```json
{
  "message": "Service category deactivated.",
  "category": {
    "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
    "name": "Plumbing",
    "slug": "plumbing",
    "visitFee": 1000,
    "isActive": false,
    "createdAt": "2026-10-01T10:00:00.000Z"
  }
}
```

## Errors

Errors use the standard API envelope containing `statusCode`, `timestamp`, `path`, and `message`. Typical results are `400` for an empty name or invalid UUID, `401` for a missing/invalid token, `403` for a non-admin user, `404` for an unknown or publicly inactive category, and `409` when a name/slug already exists.
