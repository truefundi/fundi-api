# Ads

Promotion cards for the landing page. Administrators create and schedule them
from the dashboard; the public can read them without a session.

All routes are prefixed with `/api/v1`. Public routes need no credentials.
Admin routes require an administrator session cookie or an administrator bearer
token, and answer `403` to customers and technicians.

## Model

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID | Stable identifier, also used by the image URL. |
| `productId` | integer? | Landing-page product the card points at, when it is product-specific. |
| `title` | string | Headline, 2–120 characters. |
| `description` | string | Body copy, 2–1,000 characters. |
| `imageUrl` | string? | An externally hosted image URL. |
| `imageAlt` | string? | Alt text for the image. |
| `callToAction` | string? | Button label, up to 60 characters. |
| `badge` | `LIVE` or `COMING_SOON` | Badge rendered on the card. |
| `status` | `Live` or `Coming soon` | The badge in the frontend's existing vocabulary. Derived from `badge`, not stored separately. |
| `placement` | enum | Which surface renders the card. |
| `audience` | `ALL`, `CUSTOMER`, or `TECHNICIAN` | Restricts the card to one role. |
| `isActive` | boolean | Manual visibility switch. |
| `isLive` | boolean | Derived: `isActive` and the current time is inside the scheduling window. |
| `startsAt` / `endsAt` | ISO 8601? | Scheduling window. Omit either end to leave it open. |
| `priority` | integer | Higher values sort first. `-1000` to `1000`. |
| `impressions` | integer | Incremented by `POST /ads/:id/impression`. |
| `clicks` | integer | Incremented by `POST /ads/:id/click`. |
| `createdAt` / `updatedAt` | timestamp | Audit of the row itself. |

Placements:

| Value | Surface |
| --- | --- |
| `LANDING_PRODUCT` | Product cards on the landing page (the frontend default). |
| `LANDING_HERO` | Hero slot on the landing page. |
| `MOBILE_HOME` | Home surface in the mobile apps. |
| `MOBILE_JOB_FEED` | Interleaved in the mobile job feed. |

## Public endpoints

### `GET /api/v1/ads`

Returns only ads that a visitor may see right now: `isActive` is true, the
scheduling window contains the current time, and the placement matches. Results
are ordered by `priority` descending, then newest first.

| Query | Default | Meaning |
| --- | --- | --- |
| `placement` | all placements | Filter to one surface. |
| `role` | all audiences | Also include `ALL`-audience ads. Pass `CUSTOMER` or `TECHNICIAN`. |

```http
GET /api/v1/ads?placement=LANDING_PRODUCT&role=CUSTOMER
```

```json
[
  {
    "id": "4b1c9f0a-3d2e-4b8a-9f11-7c6d5e4a3b21",
    "productId": 3,
    "title": "Fundi Home Repair",
    "description": "Book a trusted technician for plumbing and electrical work.",
    "imageUrl": "/api/v1/ads/4b1c9f0a-3d2e-4b8a-9f11-7c6d5e4a3b21/image",
    "imageAlt": "A technician repairing a kitchen sink",
    "callToAction": "Explore product",
    "badge": "LIVE",
    "status": "Live",
    "placement": "LANDING_PRODUCT",
    "audience": "ALL",
    "isActive": true,
    "isLive": true,
    "startsAt": null,
    "endsAt": null,
    "priority": 0,
    "impressions": 120,
    "clicks": 14,
    "createdAt": "2026-11-05T09:00:00.000Z",
    "updatedAt": "2026-11-05T09:00:00.000Z"
  }
]
```

`imageUrl` is the external URL when one was supplied, otherwise the stable
`/api/v1/ads/:id/image` route when a creative was uploaded. It is `null` when
the card has no image at all.

### `POST /api/v1/ads/:id/impression`

Increments `impressions` by one and returns `{ id, impressions, clicks }`.
`404` when no ad has that id. No authentication: the landing page has no session.

### `POST /api/v1/ads/:id/click`

Same as the impression route, incrementing `clicks`.

### `GET /api/v1/ads/:id/image`

Streams the uploaded creative with its stored content type. Public for the same
reason as the list route; the object key is an unguessable UUID and the bytes are
not sensitive. `Cache-Control: public, max-age=60` and `X-Content-Type-Options:
nosniff` are set. `404` when the ad does not exist or has no uploaded image.

## Admin endpoints

All of these require an administrator session.

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/ads` | List every ad, including hidden and out-of-window rows |
| `POST` | `/api/v1/admin/ads` | Create an ad |
| `GET` | `/api/v1/admin/ads/:id` | Read one ad |
| `PATCH` | `/api/v1/admin/ads/:id` | Update any subset of fields |
| `DELETE` | `/api/v1/admin/ads/:id` | Delete the ad and its uploaded creative |
| `PUT` | `/api/v1/admin/ads/:id/image` | Upload or replace the creative |
| `DELETE` | `/api/v1/admin/ads/:id/image` | Remove the uploaded creative |

### List

```http
GET /api/v1/admin/ads?placement=LANDING_PRODUCT&audience=CUSTOMER&isActive=true&limit=100&offset=0
```

```json
{
  "items": [ /* AdResponse */ ],
  "total": 12,
  "limit": 100,
  "offset": 0
}
```

`limit` is 1–200, default 100. `offset` defaults to 0.

### Create

`POST /api/v1/admin/ads`

```json
{
  "productId": 3,
  "title": "Fundi Home Repair",
  "description": "Book a trusted technician for plumbing and electrical work.",
  "imageUrl": "https://cdn.fundi.rw/ads/home-repair.png",
  "imageAlt": "A technician repairing a kitchen sink",
  "callToAction": "Explore product",
  "badge": "LIVE",
  "placement": "LANDING_PRODUCT",
  "audience": "ALL",
  "isActive": true,
  "startsAt": "2026-11-01T00:00:00.000Z",
  "endsAt": "2026-12-01T00:00:00.000Z",
  "priority": 10
}
```

Only `title` and `description` are required. Defaults: `badge: LIVE`,
`placement: LANDING_PRODUCT`, `audience: ALL`, `isActive: true`, `priority: 0`,
and no scheduling window. `endsAt` must be after `startsAt` or the request is
rejected with `400`.

### Update

`PATCH /api/v1/admin/ads/:id` accepts any subset of the create fields, so the
dashboard can flip `isActive` or move one date without resending the card.
Scheduling is validated against the stored row: patching only `endsAt` still
compares it with the existing `startsAt`.

### Delete

`DELETE /api/v1/admin/ads/:id` removes the row and, when a creative was
uploaded, the stored object. Returns `{ "message": "Ad deleted." }`.

### Image upload

`PUT /api/v1/admin/ads/:id/image` with `multipart/form-data` and a `file` field.
JPEG, PNG, and WebP up to 5 MiB. The file signature is sniffed, so a renamed
`.png` that is not an image is refused. Uploading replaces any previous
creative and clears an external `imageUrl`, so there is only ever one image.

The response is the updated ad, with `imageUrl` pointing at the public image
route.

### Image removal

`DELETE /api/v1/admin/ads/:id/image` deletes the stored object and clears
`imageKey` / `imageContentType`. `404` when there is no uploaded creative.

## Behaviour notes

- **Scheduling needs no cron.** Visibility is computed from `isActive` and the
  current time each time the public list runs, so an ad becomes visible and
  disappears on its own. There is no background job to fail or fall behind.
- **`status` is derived, not stored.** The frontend's `Live` / `Coming soon`
  vocabulary is computed from `badge`, which is the stored enum. Editing one
  never leaves the other stale.
- **Counters are best-effort.** They are a plain `increment`, so repeated calls
  add up. There is no deduplication per visitor; treat them as a trend, not an
  exact reach figure.
- **Every write is audited.** Creates, updates, deletes, and image changes write
  an `audit_logs` row (`AD_CREATED`, `AD_UPDATED`, `AD_DELETED`,
  `AD_IMAGE_UPLOADED`, `AD_IMAGE_DELETED`) with the administrator as actor.

## Common errors

| Status | Meaning |
| --- | --- |
| `400` | Validation failed, `endsAt` is not after `startsAt`, or the upload is not a supported image. |
| `401` | No administrator session. |
| `403` | The caller is not an administrator. |
| `404` | No ad has that id, or it has no uploaded creative. |
