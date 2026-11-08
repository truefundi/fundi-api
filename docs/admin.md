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

## Ads

Landing-page promotion cards are managed under `/api/v1/admin/ads`, with a
public read-only surface under `/api/v1/ads`. See [Ads API](ads.md) for the
fields, scheduling rules, placement values, impression and click counters, and
the image upload route.

## Broadcasts

Administrator messages are sent from `/api/v1/admin/broadcasts`. Each broadcast
chooses its audience roles and its delivery channel, either in-app only or
in-app plus SMS. See [Broadcasts API](broadcasts.md) for the audience preview,
the send request, and the delivery counters.

## Changing the administrator password

`POST /api/v1/auth/admin/change-password` requires the signed-in administrator's
current password and revokes every stored session. See
[Admin authentication](admin-authentication.md#post-apiv1authadminchange-password).

## Common errors

Errors have `statusCode`, `timestamp`, `path`, and `message` fields. `401` means the token is missing, invalid, or revoked; `403` means the caller is not an administrator.
