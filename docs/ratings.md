# Feedback and Ratings API

Ratings are optional. A customer or technician who owns a completed job with
an assigned technician may submit one score from **1 to 5** for every
currently active rating item. A job can receive at most one rating. The owner
cannot edit a submitted rating; an administrator can submit a rating on the
owner's behalf or correct an existing dynamic rating.

Administrators create and manage rating items such as communication, time
management, and fair pricing. Deleting an item archives it: it disappears from
future rating forms, but its historical scores and the item name recorded with
each score remain available in reports. Archived items can be reactivated with
`PATCH`.

All routes below are prefixed with `/api/v1`. Authenticated owner and
technician routes require bearer tokens; administrator routes require an admin
session cookie or administrator bearer token.

## Administer rating items

| Method   | URL                           | Purpose                        |
| -------- | ----------------------------- | ------------------------------ |
| `GET`    | `/admin/rating-items`         | List active and archived items |
| `GET`    | `/admin/rating-items/:itemId` | Get one item                   |
| `POST`   | `/admin/rating-items`         | Create an item                 |
| `PATCH`  | `/admin/rating-items/:itemId` | Edit or reactivate an item     |
| `DELETE` | `/admin/rating-items/:itemId` | Archive an item                |

Create:

```json
{
  "name": "Time management",
  "description": "Arrived and completed the work at the agreed times.",
  "sortOrder": 1
}
```

`name` is required. `description` and `sortOrder` are optional.

## Job owner: rate a completed job

The owner may be a customer or technician, and must own the job. The job must
be completed and have an assigned technician.

### Get available rating items

**GET** `/jobs/mine/:jobId/rating-items`

```json
{
  "jobId": "c0d0f493-35af-4601-8307-efda0ee83d7f",
  "items": [
    {
      "id": "00d85d71-96c8-4302-9989-194150e451d1",
      "name": "Communication",
      "description": "Communicated clearly and respectfully.",
      "sortOrder": 0,
      "isActive": true
    }
  ],
  "canSubmit": true,
  "rating": null
}
```

If the job has already been rated, `canSubmit` is `false`; a dynamic rating
already submitted by the owner is included in `rating`. If an administrator
used the older fixed-field rating endpoint, the response also indicates that
the job cannot be submitted again through the dynamic flow.

### Submit the optional rating

**POST** `/jobs/mine/:jobId/rating`

```json
{
  "responses": [
    { "itemId": "00d85d71-96c8-4302-9989-194150e451d1", "score": 5 },
    { "itemId": "84756e14-f08a-4a43-92b2-c80f2ef1c2a8", "score": 4 }
  ],
  "comment": "Arrived on time and explained the repair clearly."
}
```

The request must include exactly one response for each active item. Scores are
integers from 1 to 5. `comment` is optional. Ratings are submitted once per
job; the database enforces this even if simultaneous requests arrive.

### Read the submitted rating

**GET** `/jobs/mine/:jobId/rating`

Returns the owner's rating, including its item names and scores. The response
does not expose customer identity to technicians.

## Technician: view own ratings

**GET** `/technicians/profile/ratings?page=1&limit=20`

Returns paginated ratings, the average across all submitted item scores, and
averages for each item name. The technician sees rating comments and job
details, but not the customer's identity. This endpoint provides rating data
for future matching improvements; ratings are **not currently used** by the
matching algorithm.

## Admin: inspect and manage ratings

| Method  | URL                                                        | Purpose                                               |
| ------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| `GET`   | `/admin/technicians/:technicianId/ratings?page=1&limit=20` | Paginated history, overall average, and item averages |
| `GET`   | `/admin/jobs/:jobId/ratings`                               | Inspect the dynamic rating for one job                |
| `POST`  | `/admin/jobs/:jobId/ratings`                               | Submit a dynamic rating on behalf of the owner        |
| `PATCH` | `/admin/jobs/:jobId/ratings`                               | Correct an existing dynamic rating                    |

Admin create uses the same body as the owner's submit endpoint. For a
correction, send a comment, scores, or both. If scores are supplied, include
exactly the items already recorded for that rating; historical item snapshots
are preserved even if an item was subsequently renamed or archived.

The existing **singular** `POST /admin/jobs/:jobId/rating` endpoint remains
available for compatibility with its fixed `overall`, `quality`,
`professionalism`, `arrival`, `communication`, and `value` request body. It is
separate from the dynamic rating schema, but a job rated through either flow
cannot be submitted a second time through the other flow.

## Ratings and matching

Technician and administrator reports expose average ratings and per-item
averages. The matching algorithm does not yet include ratings in technician
ranking; that can be added as a separate, measured matching improvement.
