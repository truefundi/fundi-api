# Audit logs API

The platform records important state changes in the append-only `audit_logs` table. These records are intended for operational review and traceability (for example: who changed a status, when, and on which entity).

All routes below are prefixed with `/api/v1` and require an administrator session/cookie (see [Admin authentication](admin-authentication.md)). Only accounts with the `ADMIN` role may call these routes.

## Endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| `GET` | `/admin/audit-logs` | List audit log entries (newest first) with optional filters |
| `GET` | `/admin/audit-logs/:id` | Get a single audit log entry by id |

## List audit logs

`GET /api/v1/admin/audit-logs`

### Query parameters

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `entityType` | string | No | Filter by entity type (for example `Job`, `User`, `Dispute`, `CatalogCategory`, `ServiceCategory`, `Broadcast`, `Ad`). |
| `entityId` | string | No | Filter by the affected entity id. |
| `action` | string | No | Filter by action (for example `JOB_CREATED`, `DISPUTE_OPENED`, `ADMIN_PASSWORD_CHANGED`). |
| `actorId` | UUID | No | Filter by the user/admin who performed the action. |
| `from` | ISO-8601 date-time | No | Return logs created at or after this timestamp. |
| `to` | ISO-8601 date-time | No | Return logs created at or before this timestamp. |
| `limit` | integer | No | Page size. Default `50`, min `1`, max `200`. |
| `offset` | integer | No | Records to skip. Default `0`. |

### Request example

```http
GET /api/v1/admin/audit-logs?entityType=Job&entityId=2f7a0f6e-4b3d-4f5a-9b7d-1d2f3c4b5a6e&limit=20&offset=0
Cookie: fundi_admin_access_token=<admin-access-cookie>
```

Equivalent curl shape (when using the admin session cookie jar):

```bash
curl -X GET "http://localhost:3000/api/v1/admin/audit-logs?entityType=Job&entityId=2f7a0f6e-4b3d-4f5a-9b7d-1d2f3c4b5a6e&limit=20&offset=0" \
  -H "Accept: application/json" \
  --cookie "fundi_admin_access_token=<admin-access-cookie>"
```

### Response shape (`200`)

```json
{
  "items": [
    {
      "id": "8d2b6a91-1c34-4d7b-a4e2-9f0c1d2e3f45",
      "entityType": "Job",
      "entityId": "2f7a0f6e-4b3d-4f5a-9b7d-1d2f3c4b5a6e",
      "action": "JOB_STATUS_UPDATED",
      "fromStatus": "OPEN",
      "toStatus": "ASSIGNED",
      "actorId": "1a4e8f20-9b7c-4d11-8e5a-6b2c3d4e5f60",
      "metadata": {
        "reason": "Technician accepted the offer",
        "source": "system"
      },
      "createdAt": "2026-11-13T08:42:15.123Z"
    },
    {
      "id": "5f6e7d8c-9b0a-4c3d-b2e1-0f9e8d7c6b5a",
      "entityType": "Job",
      "entityId": "2f7a0f6e-4b3d-4f5a-9b7d-1d2f3c4b5a6e",
      "action": "JOB_CREATED",
      "fromStatus": null,
      "toStatus": "OPEN",
      "actorId": "c3b2a190-7d6e-4f5a-8123-456789abcdef",
      "metadata": {
        "serviceCategoryId": "e5a4f4d7-0b21-46d8-9a4b-98765d332100",
        "requestType": "NORMAL"
      },
      "createdAt": "2026-11-13T08:30:00.000Z"
    }
  ],
  "total": 2,
  "limit": 20,
  "offset": 0
}
```

Notes:
- `items` is ordered by `createdAt` descending (newest first), then `id` descending.
- `fromStatus`, `toStatus`, `actorId`, and `metadata` may be `null` depending on the action.
- `metadata` is action-specific JSON recorded at write time.

## Get one audit log

`GET /api/v1/admin/audit-logs/:id`

### Request example

```http
GET /api/v1/admin/audit-logs/8d2b6a91-1c34-4d7b-a4e2-9f0c1d2e3f45
Cookie: fundi_admin_access_token=<admin-access-cookie>
```

### Response shape (`200`)

```json
{
  "id": "8d2b6a91-1c34-4d7b-a4e2-9f0c1d2e3f45",
  "entityType": "Job",
  "entityId": "2f7a0f6e-4b3d-4f5a-9b7d-1d2f3c4b5a6e",
  "action": "JOB_STATUS_UPDATED",
  "fromStatus": "OPEN",
  "toStatus": "ASSIGNED",
  "actorId": "1a4e8f20-9b7c-4d11-8e5a-6b2c3d4e5f60",
  "metadata": {
    "reason": "Technician accepted the offer",
    "source": "system"
  },
  "createdAt": "2026-11-13T08:42:15.123Z"
}
```

## Errors

- `401 Unauthorized`: missing, invalid, or expired admin session.
- `403 Forbidden`: caller is authenticated but not an administrator.
- `404 Not found` (`GET /:id`): no audit log entry exists with the provided id.
- `400 Bad Request`: invalid query parameter format (for example a non-UUID `actorId`, invalid date, or out-of-range `limit`).

Audit log entries are append-only and cannot be modified or deleted through the API.
