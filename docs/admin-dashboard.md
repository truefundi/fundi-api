# Admin dashboard analytics

These read-only endpoints provide summary cards, chart series, breakdowns,
technician rankings, audit history, and a live audit feed for the admin
dashboard.

All endpoints are under `/api/v1/admin/dashboard` and require an authenticated
administrator session cookie. Administrator bearer tokens are not accepted.
Unless specified otherwise, date ranges use the `currentMonth` period in UTC.
Every range is returned with an inclusive `from` and exclusive `to`.

## Shared period and filters

| Query parameter                                          | Description                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `period`                                                 | `today`, `last7days`, `currentMonth`, `month`, `currentYear`, `year`, or `custom`.        |
| `timezone`                                               | IANA timezone used for calendar boundaries and trend buckets; defaults to `UTC`.          |
| `month`                                                  | Required as `YYYY-MM` only with `period=month`.                                           |
| `year`                                                   | Required as `YYYY` only with `period=year`.                                               |
| `from`, `to`                                             | ISO date/time instants required together only with `period=custom`; `to` is exclusive.    |
| `serviceCategoryId`                                      | Restrict job-related metrics to a service category.                                       |
| `customerId`                                             | Restrict relevant account, job, payment, notification, and related metrics to a customer. |
| `technicianId`                                           | Restrict technician, job, payment, chat, rating, and related metrics to a technician.     |
| `requestType`                                            | Restrict jobs and payments by request type.                                               |
| `jobStatus`                                              | Restrict job-related metrics by job status.                                               |
| `userRole`, `userStatus`                                 | Restrict account and applicable user-related metrics.                                     |
| `technicianVerificationStatus`, `technicianAvailability` | Restrict technician profile and document metrics.                                         |
| `paymentStatus`                                          | Restrict payment metrics.                                                                 |
| `chatMessageType`                                        | Restrict chat metrics by message type.                                                    |

Filters apply to relevant domains only. For example, `paymentStatus` affects
payment results and `chatMessageType` affects chat results. Technician
verification and availability are current profile states; they are not
historical snapshots.

## Endpoints

### `GET /overview`

Returns summary-card values for accounts, technician profiles, jobs, payments,
disputes, chat, ratings, broadcasts, notifications, conversations, technician
documents, cancellation requests, job offers, ads, catalog, and audit events.
It also reports phone verification and passkey counts.

The `technicians.newProfiles` count is limited to the requested period;
`currentByVerificationStatus` and `currentByAvailability` are current
population snapshots. `disputes.currentlyUnresolved`,
`users.currentlyPhoneVerified`, and `users.accountsWithPasskeys` are also
current snapshots rather than period-created counts.

Ad impression and click values are lifetime counters because the database does
not store individual impression or click timestamps.

The `catalog` section distinguishes category and service categories created in
the selected period from their current totals, each split by active state.
`serviceCategoryId` narrows service totals to that service; category totals
remain platform-wide.

Pass `compare=true` to include comparison values for new accounts, jobs,
payments, disputes, and ratings. The comparison is the immediately preceding
interval of equal duration. Change percentages are `null` when the previous
value is zero or an average is unavailable.

### `GET /trends`

Returns sparse time-series data for new accounts, jobs created and completed,
payment counts and booking amounts, disputes, chat messages, ratings submitted,
average rating scores, new catalog categories, and new services. A bucket
appears only when there is data for it; clients can render missing buckets as
zero when appropriate.

Accepts all shared parameters and:

| Query parameter | Description                                                            |
| --------------- | ---------------------------------------------------------------------- |
| `interval`      | `hour`, `day`, `week`, or `month`. Defaults based on the range length. |

Each series has `domain`, `metric`, and `data` fields. `data` contains
`{ bucket, value }` points. Booking amounts are in RWF; average rating values
are averaged across submitted rating-item responses.

### `GET /breakdowns`

Returns grouped data for account roles and statuses, current technician
verification and availability, jobs and service categories, payments,
disputes, chat messages and rooms, conversations, offers, rating items,
technician documents, advertisements, broadcasts, notifications, and
cancellation requests. The `catalog` section breaks down new catalog
categories by active status and new services by parent category and active
status. Job category breakdowns include the service category and its parent
catalog category.

### `GET /top-technicians`

Ranks technicians with completed jobs in the requested period. Results are
ordered by completed-job count, then average rating, and then technician ID.
Each row includes rank, technician ID and name, current verification and
availability states, completed-job count, rating count, and average rating.

Accepts all shared parameters and:

| Query parameter | Description                                  |
| --------------- | -------------------------------------------- |
| `limit`         | Maximum rows, from 1 to 100; defaults to 10. |

### `GET /activity`

Returns paginated audit records ordered newest first, including actor identity
when the account still exists.

| Query parameter                   | Description                               |
| --------------------------------- | ----------------------------------------- |
| `entityType`, `action`, `actorId` | Filter audit records.                     |
| `limit`                           | Page size from 1 to 100; defaults to 20.  |
| `offset`                          | Number of records to skip; defaults to 0. |

The response includes `data` and `pagination` (`limit`, `offset`, `total`, and
`hasMore`).

### `GET /events` (Server-Sent Events)

Streams newly written audit records as `dashboard.activity` events. Each event
contains the audit record in `data` and a resumable event `id`. The server polls
for new rows every two seconds. Send the previous `Last-Event-ID` when
reconnecting; standard `EventSource` clients do this automatically.

This stream is live-only for a new connection. Use `GET /activity` to load
existing records.
