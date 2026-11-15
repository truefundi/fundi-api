# Service Catalog API

The catalog has two levels: database-managed **categories** (for example,
Home Services or Car Services) and **services** within a category (for
example, Plumbing). A service is the priced offering selected for technician
profiles and jobs. Although existing API fields such as `categoryId` and
`serviceCategoryId` retain their names, they refer to a service ID, not to a
parent category ID.

Public clients can list and search active categories and services. Only
administrators can create, edit, or deactivate either resource. Services have
optional search `keywords`; when returned, every service includes its parent
category's details. Deactivation is soft, preserving existing job and
technician references. A service under an inactive parent category is hidden
from public service listings and search.

For local development, seed the sample catalog with `npm run prisma:seed`.

All routes below are prefixed with `/api/v1`. Administrator routes require an
admin session cookie or administrator bearer token. JSON requests use
`Content-Type: application/json`.

## Categories

### Public category endpoints

| Method | URL                                    | Purpose                          |
| ------ | -------------------------------------- | -------------------------------- |
| `GET`  | `/catalog/categories`                  | List active parent categories    |
| `GET`  | `/catalog/categories/search?name=home` | Search active categories by name |
| `GET`  | `/catalog/categories/:id`              | Get one active category          |

Category response:

```json
{
  "id": "84cfa9af-05d4-40c1-ad36-123e412ec509",
  "name": "Home Services",
  "description": "Repairs and maintenance for homes.",
  "isActive": true,
  "createdAt": "2026-10-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T10:00:00.000Z"
}
```

### Administrator category endpoints

| Method   | URL                                                      | Purpose                                  |
| -------- | -------------------------------------------------------- | ---------------------------------------- |
| `POST`   | `/catalog/categories`                                    | Create a category                        |
| `PATCH`  | `/catalog/categories/:id`                                | Update a category                        |
| `DELETE` | `/catalog/categories/:id`                                | Deactivate a category                    |
| `GET`    | `/catalog/admin/categories`                              | List all categories, including inactive  |
| `GET`    | `/catalog/admin/categories/:id`                          | Get a category by ID, including inactive |
| `GET`    | `/catalog/admin/categories/by-name?name=Home%20Services` | Find a category by exact name            |

Create request:

```json
{
  "name": "Home Services",
  "description": "Repairs and maintenance for homes."
}
```

Only `name` and `description` are stored on a parent category. Both fields
are required at creation; updates must include at least one of `name`,
`description`, or `isActive`.

## Services

### Public service endpoints

| Method | URL                                  | Purpose                                        |
| ------ | ------------------------------------ | ---------------------------------------------- |
| `GET`  | `/catalog/services`                  | List active services under active categories   |
| `GET`  | `/catalog/services/search?name=leak` | Search active service names and keywords       |
| `GET`  | `/catalog/services/:id`              | Get one active service and its parent category |

Service response:

```json
{
  "id": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
  "categoryId": "84cfa9af-05d4-40c1-ad36-123e412ec509",
  "name": "Plumbing",
  "slug": "plumbing",
  "description": "Leak repairs, pipe fitting, and drain unblocking.",
  "keywords": "leak repair, pipes, blocked drain",
  "bookingFee": 1000,
  "emergencyVisitFee": 1500,
  "sosBookingFee": 2500,
  "icon": "wrench",
  "isActive": true,
  "createdAt": "2026-10-01T10:00:00.000Z",
  "updatedAt": "2026-10-01T10:00:00.000Z",
  "category": {
    "id": "84cfa9af-05d4-40c1-ad36-123e412ec509",
    "name": "Home Services",
    "description": "Repairs and maintenance for homes.",
    "isActive": true,
    "createdAt": "2026-10-01T10:00:00.000Z",
    "updatedAt": "2026-10-01T10:00:00.000Z"
  }
}
```

### Administrator service endpoints

| Method   | URL                                             | Purpose                                 |
| -------- | ----------------------------------------------- | --------------------------------------- |
| `POST`   | `/catalog/services`                             | Create a service                        |
| `PATCH`  | `/catalog/services/:id`                         | Update a service                        |
| `DELETE` | `/catalog/services/:id`                         | Deactivate a service                    |
| `GET`    | `/catalog/admin/services`                       | List all services, including inactive   |
| `GET`    | `/catalog/admin/services/:id`                   | Get a service by ID, including inactive |
| `GET`    | `/catalog/admin/services/by-name?name=Plumbing` | Find a service by exact name            |

Create request:

```json
{
  "categoryId": "84cfa9af-05d4-40c1-ad36-123e412ec509",
  "name": "Plumbing",
  "description": "Leak repairs, pipe fitting, and drain unblocking.",
  "keywords": "leak repair, pipes, blocked drain",
  "icon": "wrench",
  "bookingFee": 1000,
  "emergencyVisitFee": 1500,
  "sosBookingFee": 2500
}
```

`categoryId` is required and must identify an active parent category.
`keywords` is an optional string (up to 500 characters); omit it when there
are no extra search terms. `icon` is an optional icon identifier. Booking and
emergency fees are non-negative integer RWF amounts; an SOS fee, if supplied,
must be positive and greater than the normal booking fee. The service slug is
generated from its name.

An update accepts any of the service fields. To move a service, provide a new
active parent `categoryId`. Setting `icon` to `null` clears it. Deactivation
does not physically delete the service.

## Errors

Errors use the standard API envelope containing `statusCode`, `timestamp`,
`path`, and `message`. Typical results are `400` for invalid input or an
inactive parent category, `401` for missing or invalid authentication, `403`
for a non-admin user, `404` for an unknown or publicly inactive resource, and
`409` for duplicate category or service names/slugs.
