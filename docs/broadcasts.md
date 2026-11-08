# Broadcasts

Administrator messages sent to a group of active users. Each broadcast picks at
least one audience role and at least one delivery channel: in-app only, or
in-app plus SMS.

All routes are prefixed with `/api/v1/admin/broadcasts` and require an
administrator session cookie or an administrator bearer token. Customers and
technicians receive `403`.

## Delivery channels

| Channel | What happens |
| --- | --- |
| `IN_APP` | One `Notification` row per recipient with type `BROADCAST`, in the same inbox the apps already read. A connected recipient also receives `notification:new` over the `/events` socket namespace. |
| `SMS` | The same notification is written when `IN_APP` is also selected, and every recipient with a phone number is texted. |

Every broadcast must select at least one channel. There is no implicit default:
if `channels` is empty the request is rejected with `400`.

In development the SMS driver is `console`, so messages are written to the API
log rather than sent. If `SMS_MODE` is set to anything other than `console`
without a provider integration, each SMS delivery fails and the broadcast is
recorded as `PARTIAL` or `FAILED` instead of pretending it succeeded.

## Audience

```json
{
  "roles": ["CUSTOMER", "TECHNICIAN"],
  "status": "active"
}
```

- `roles` must contain at least one of `CUSTOMER` or `TECHNICIAN`.
  Administrators can never be targeted.
- `status` is always `active`; it mirrors the dashboard's audience picker and is
  rejected if another value is supplied.
- Only `ACTIVE` accounts are resolved. `INACTIVE` and `SUSPENDED` accounts are
  skipped.

The dashboard can mix roles. Duplicate roles in the array are collapsed before
the query runs.

## `POST /api/v1/admin/broadcasts/preview`

Counts the audience before the operator confirms sending. No message is
delivered.

```json
{
  "roles": ["CUSTOMER"],
  "status": "active"
}
```

```json
{
  "userCount": 842,
  "smsRecipientCount": 842,
  "inAppRecipientCount": 842
}
```

| Field | Meaning |
| --- | --- |
| `userCount` | Active accounts in the selected roles. |
| `smsRecipientCount` | Those with a non-empty phone number. |
| `inAppRecipientCount` | Those who can receive an in-app notification. Every account has an inbox, so this equals `userCount`. |

## `POST /api/v1/admin/broadcasts`

Sends immediately. The dashboard has no draft or scheduled step; there is no
`scheduledAt` field and no scheduling worker.

```json
{
  "title": "Important service update",
  "message": "Fundi will be unavailable for maintenance tonight between 22:00 and 23:00.",
  "audience": {
    "roles": ["CUSTOMER"],
    "status": "active"
  },
  "channels": ["IN_APP", "SMS"]
}
```

| Field | Rules |
| --- | --- |
| `title` | 2–80 characters. Also the notification title and the SMS prefix. |
| `message` | 1–320 characters. SMS body after the title prefix. |
| `audience` | See above. |
| `channels` | One or both of `IN_APP`, `SMS`. |

SMS is sent as `<title>: <message>`.

Response (`201`) — the record plus the delivery counters:

```json
{
  "id": "b1d4c7e2-9a3f-4f61-8e2d-5c0a7b6d4e31",
  "title": "Important service update",
  "message": "Fundi will be unavailable for maintenance tonight between 22:00 and 23:00.",
  "audience": { "roles": ["CUSTOMER"], "status": "active" },
  "channels": ["IN_APP", "SMS"],
  "status": "SENT",
  "mode": "queued",
  "userCount": 842,
  "smsRecipientCount": 842,
  "inAppRecipientCount": 842,
  "smsSentCount": 842,
  "smsFailedCount": 0,
  "inAppSentCount": 842,
  "error": null,
  "sentAt": "2026-11-05T09:00:00.000Z",
  "createdAt": "2026-11-05T09:00:00.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `userCount` | Audience size, frozen when the broadcast is created. |
| `smsRecipientCount` | Recipients targeted for SMS, frozen at creation. |
| `inAppRecipientCount` | Recipients targeted for in-app delivery, `0` when `IN_APP` was not selected. |
| `smsSentCount` | SMS messages accepted by the provider. |
| `smsFailedCount` | SMS messages the provider refused. |
| `inAppSentCount` | Notification rows inserted. |
| `status` | `SENT` when every attempted delivery succeeded, `PARTIAL` when some failed, `FAILED` when none succeeded. |
| `error` | Up to three distinct failure messages, joined with a pipe and truncated. |
| `mode` | Always `queued`. Kept for the frontend's existing record shape. |
| `sentAt` | When delivery finished. |

The audience and its counts are stored on the row, so history still reads
correctly after users join, leave, or change status. The counts are not
recomputed later.

## `GET /api/v1/admin/broadcasts`

Newest first. `limit` is 1–100 (default 20), `offset` defaults to 0.

```json
{
  "items": [ /* BroadcastResponse */ ],
  "total": 5,
  "limit": 20,
  "offset": 0
}
```

## `GET /api/v1/admin/broadcasts/:id`

Returns one broadcast with its frozen counts and delivery results. `404` when no
broadcast has that id.

## Behaviour notes

- **Delivery is synchronous.** The request returns once every notification row
  is inserted and every SMS attempt has finished. Large audiences therefore
  make the request longer, and an SMS provider outage makes it slower still.
  Moving delivery to a queue is the natural next step if audiences grow.
- **In-app writes are batched.** Notification rows are inserted 500 at a time,
  which stays inside Postgres' bind-parameter limit and avoids one query per
  recipient.
- **SMS failures do not roll back the broadcast.** In-app recipients are already
  notified, so the row is updated with the true per-channel result rather than
  discarded.
- **Every send is audited.** A `BROADCAST_SENT` audit row records the roles,
  channels, audience size, and per-channel counts, with the administrator as
  actor.

## Common errors

| Status | Meaning |
| --- | --- |
| `400` | Validation failed, no roles selected, no channels selected, or the selected roles have no active recipients. |
| `401` | No administrator session. |
| `403` | The caller is not an administrator. |
| `404` | No broadcast has that id. |
