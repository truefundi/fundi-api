# Admin dashboard API

All routes are prefixed with `/api/v1` and require an administrator session:

```http
Authorization: Bearer <admin-access-token>
```

Only accounts with the `ADMIN` role may call these routes. Customers and technicians receive `403`.

## `GET /api/v1/admin/stats` (Admin)

Returns the platform-wide account counts shown on the dashboard. No request body or query parameters.

Success response (`200`):

```json
{
  "totalUsers": 842,
  "totalCustomers": 730,
  "totalTechnicians": 112,
  "pendingVerifications": 9,
  "suspendedAccounts": 4
}
```

| Field | Description |
| --- | --- |
| `totalUsers` | `totalCustomers + totalTechnicians`. Administrators are excluded. |
| `totalCustomers` | Accounts with the `CUSTOMER` role. |
| `totalTechnicians` | Accounts with the `TECHNICIAN` role. |
| `pendingVerifications` | Technician profiles whose `verificationStatus` is `PENDING`. |
| `suspendedAccounts` | Customer and technician accounts whose `status` is `SUSPENDED`. |

The platform has three account statuses: `ACTIVE`, `INACTIVE`, and `SUSPENDED`.
`suspendedAccounts` counts `SUSPENDED` customer and technician accounts — the
blocked state that forbids login and sessions. (`INACTIVE` is a separate
opt-out state and is not counted.) Administrators are never counted here.

The dashboard's job counts come from `GET /api/v1/admin/jobs/summary`; see [Jobs API](jobs.md#administrator-endpoints).

Administrators can review technician cancellation requests, edit jobs, and
permanently delete only completed or cancelled jobs. They can also inspect
booking payments and extend their validity. See [Jobs API](jobs.md#administrator-endpoints)
and [Booking Payments API](booking-payments.md#administrator-endpoints) for
request bodies and lifecycle rules.

## Common errors

Errors have `statusCode`, `timestamp`, `path`, and `message` fields. `401` means the token is missing, invalid, or revoked; `403` means the caller is not an administrator.
