# Analytics API

The Analytics API lets you retrieve usage and search analytics for your tenant (pageviews, search behavior, resource popularity, visitor sessions, geographic activity, and more), and lets you send your own custom events for tracking. All data is scoped to your tenant and the website(s) associated with your account.

## Table of contents

- [Authentication](#authentication)
- [Base URL & versioning](#base-url--versioning)
- [Common conventions](#common-conventions)
  - [Date ranges](#date-ranges)
  - [Filtering by website](#filtering-by-website)
  - [Timezones](#timezones)
  - [Pagination](#pagination)
  - [Caching & data freshness](#caching--data-freshness)
  - [Error responses](#error-responses)
- [Endpoints](#endpoints)
  - [GET /analytics/info](#get-analyticsinfo)
  - [GET /analytics/stats](#get-analyticsstats)
  - [GET /analytics/pageviews](#get-analyticspageviews)
  - [GET /analytics/metrics](#get-analyticsmetrics)
  - [GET /analytics/resource-metrics](#get-analyticsresource-metrics)
  - [GET /analytics/searches](#get-analyticssearches)
  - [GET /analytics/zero-result-queries](#get-analyticszero-result-queries)
  - [GET /analytics/language-switches](#get-analyticslanguage-switches)
  - [GET /analytics/resource-by-entry](#get-analyticsresource-by-entry)
  - [GET /analytics/sessions](#get-analyticssessions)
  - [GET /analytics/export-search-data](#get-analyticsexport-search-data)
  - [GET /analytics/heatmap](#get-analyticsheatmap)
  - [GET /analytics/area-searches](#get-analyticsarea-searches)
  - [GET /analytics/event-values](#get-analyticsevent-values)
  - [GET /analytics/event-catalog](#get-analyticsevent-catalog)
  - [POST /analytics/events](#post-analyticsevents)
  - [POST /analytics/events/batch](#post-analyticseventsbatch)
- [Appendix: built-in tracked metrics](#appendix-built-in-tracked-metrics)

---

## Authentication

Every request to the Analytics API must include three headers:

| Header | Required | Description |
|---|---|---|
| `x-api-version` | Yes | API version. Currently only `1` is supported. Requests without this header (or with an unsupported value) will not match any route and return `404`. |
| `x-tenant-id` | Yes | Your tenant identifier. |
| `x-analytics-api-key` | Yes | Your tenant's Analytics API key. |

Your `x-analytics-api-key` is issued to you by your account/support contact — reach out if you don't have one yet or believe it needs to be rotated.

If any of these headers is missing or invalid, the API returns `401 Unauthorized`:

```json
{
  "status": 401,
  "message": "Invalid analytics API key for this tenant",
  "path": "/analytics/stats",
  "method": "GET"
}
```

## Base URL & versioning

```
https://<your-api-host>/analytics/<endpoint>
```

There is no versioned URL path (e.g. no `/v1/`) — versioning is done entirely via the `x-api-version` header described above.

## Common conventions

### Date ranges

Every endpoint (except `/analytics/event-catalog`) requires `start` and `end` query parameters:

- Must be strict ISO-8601 timestamps, e.g. `2025-01-01T00:00:00Z`.
- `end` must be on or after `start`.
- Neither `start` nor `end` may be in the future.
- The range between `start` and `end` cannot exceed **365 days**.

Violating any of these rules returns a `400 Bad Request` with a specific message, e.g. `"Date range cannot exceed 365 days"`.

### Filtering by website

If your tenant has more than one website/property configured, you can scope a request to specific ones with the `websiteIds` query parameter — a comma-separated list of website IDs:

```
?websiteIds=abc-123,def-456
```

If omitted, your tenant's default (root) website is used. Requesting a website ID that isn't associated with your tenant returns `403 Forbidden`.

You can discover your available website IDs via [`GET /analytics/info`](#get-analyticsinfo).

### Timezones

Only [`GET /analytics/pageviews`](#get-analyticspageviews) and [`GET /analytics/metrics`](#get-analyticsmetrics) accept an optional `timezone` parameter (an IANA timezone name, e.g. `America/Chicago`). It defaults to `UTC` and controls how results are bucketed by day. All other endpoints operate on raw UTC timestamps.

### Pagination

Only [`GET /analytics/sessions`](#get-analyticssessions) is paginated, using `page` (1-indexed, default `1`) and `limit` (default `100`, max `1000`) query parameters. The response includes `count` (the number of items *on the current page*, not a grand total) — to retrieve all results, keep incrementing `page` until the returned `data` array is shorter than `limit`.

[`GET /analytics/export-search-data`](#get-analyticsexport-search-data) is **not** paginated — it returns all matching rows in a single response along with a `totalCount`. Because the maximum date range is 365 days, large exports can return sizeable payloads; request smaller date windows if you need to keep payloads manageable.

### Caching & data freshness

Responses include `Cache-Control` headers and may be served from cache for a short period:

- Date ranges that include today (or the future) are cached for up to **5 minutes**.
- Date ranges that are entirely in the past ("closed" ranges) are cached for up to **1 hour**, since that data won't change.
- `GET /analytics/sessions`, `GET /analytics/heatmap`, and `GET /analytics/area-searches` are always cached for up to 5 minutes regardless of date range.

If you need guaranteed real-time data, avoid relying on identical repeated requests within these windows.

### Error responses

All errors share a common JSON shape:

```json
{
  "status": 400,
  "message": "end must be on or after start",
  "path": "/analytics/stats",
  "method": "GET"
}
```

`message` may be a single string or (for validation errors with multiple problems) an array of strings.

Common status codes across all endpoints:

| Status | Meaning |
|---|---|
| `400 Bad Request` | Invalid or missing query/body parameters (bad date format, invalid date range, missing required fields, batch size exceeded, etc.) |
| `401 Unauthorized` | Missing/invalid auth headers, or no analytics configuration found for your tenant |
| `403 Forbidden` | Requested `websiteId(s)` are not associated with your tenant |
| `404 Not Found` | Route not found — commonly caused by a missing/incorrect `x-api-version` header |
| `500 Internal Server Error` | Unexpected server error |

---

## Endpoints

### GET /analytics/info

Returns your tenant's analytics configuration, including which website IDs are available to query.

**Query parameters:** none.

```bash
curl -X GET 'https://<host>/analytics/info' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
{
  "rootWebsiteId": "abc-123",
  "additionalWebsiteIds": ["def-456", "ghi-789"],
  "websites": [
    { "id": "abc-123", "name": "My Resource Directory" }
  ]
}
```

### GET /analytics/stats

Basic aggregate stats (pageviews, visitors, visits, bounces, total time) for a date range, including a comparison against the equivalent prior period.

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/stats?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
{
  "bounces": 100,
  "pageviews": 1000,
  "totaltime": 3600,
  "visitors": 200,
  "visits": 250,
  "comparison": {
    "bounces": 90,
    "pageviews": 950,
    "totaltime": 3400,
    "visitors": 180,
    "visits": 230
  }
}
```

### GET /analytics/pageviews

Daily pageview counts across the date range.

**Query parameters:** `start`, `end` (required), `websiteIds`, `timezone` (optional, default `UTC`).

```bash
curl -X GET 'https://<host>/analytics/pageviews?start=2025-01-01T00:00:00Z&end=2025-01-07T23:59:59Z&timezone=America/Chicago' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  { "date": "2025-01-01", "hits": 320 },
  { "date": "2025-01-02", "hits": 280 }
]
```

### GET /analytics/metrics

Aggregated engagement metrics for the date range — search activity plus all tracked interaction/click events. See the [appendix](#appendix-built-in-tracked-metrics) for the full list of fields.

**Query parameters:** `start`, `end` (required), `websiteIds`, `timezone` (optional, default `UTC`).

```bash
curl -X GET 'https://<host>/analytics/metrics?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
{
  "searches": 500,
  "resourceViews": 300,
  "zeroResults": 45,
  "directions": 80,
  "phoneCalls": 60,
  "websiteClicks": 120,
  "smsClicks": 0,
  "widgetSearches": 150,
  "calloutClicks": 35,
  "languageSwitches": 12,
  "resourceViewed": 30,
  "safeExitClicks": 25,
  "favoriteAddToList": 40,
  "highlightClicks": 15,
  "alertClicks": 10
}
```

### GET /analytics/resource-metrics

Pageview counts per resource, sorted by most viewed first.

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/resource-metrics?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  { "title": "Food Bank", "views": 142 }
]
```

### GET /analytics/searches

Total search query counts, grouped by search type (`text`, `taxonomy`, `hybrid`).

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/searches?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
{
  "text": [{ "query": "example search query", "hits": 42 }],
  "taxonomy": [],
  "hybrid": []
}
```

### GET /analytics/zero-result-queries

Search queries that returned no results — useful for identifying content gaps.

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/zero-result-queries?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  { "query": "free wifi", "hits": 28 }
]
```

### GET /analytics/language-switches

Counts of how many times visitors switched to each language.

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/language-switches?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  { "language": "fr", "count": 45 }
]
```

### GET /analytics/resource-by-entry

Resource view counts grouped by the entry page (e.g. which search results page led to the view).

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/resource-by-entry?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  { "entry": "/search?query_label=food", "count": 73 }
]
```

### GET /analytics/sessions

Paginated list of visitor sessions with device/browser/location details. See [Pagination](#pagination).

**Query parameters:** `start`, `end` (required), `websiteIds`, `page` (default `1`), `limit` (default `100`, max `1000`).

```bash
curl -X GET 'https://<host>/analytics/sessions?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z&page=1&limit=100' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
{
  "page": 1,
  "limit": 100,
  "count": 42,
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "websiteId": "def-456",
      "hostname": "example.com",
      "browser": "Chrome",
      "os": "Windows",
      "device": "desktop",
      "screen": "1920x1080",
      "language": "en-US",
      "country": "US",
      "region": "California",
      "city": "San Francisco",
      "firstAt": "2025-01-01T00:00:00Z",
      "lastAt": "2025-01-31T23:59:59Z",
      "visits": 5,
      "views": 12,
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### GET /analytics/export-search-data

Detailed, row-level search event data suitable for CSV export/reporting — one row per search, with timestamps, coordinates, ZIP codes, and anonymized user/session identifiers. Not paginated (see [Pagination](#pagination)).

`userId` and `sessionId` are anonymized, one-way-hashed identifiers derived from client-generated values — they contain no personally identifiable information, but can be used to correlate multiple searches from the same visitor/session.

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/export-search-data?start=2025-01-01T00:00:00Z&end=2025-01-07T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
{
  "data": [
    {
      "timestamp": "2025-01-15T14:23:45.000Z",
      "userId": "a3f9c2b1e4d6f0a8b7c5d3e1",
      "sessionId": "b7e1d4a9c2f8036e5b1a9d0c",
      "queryLabel": "homeless shelter",
      "queryType": "text",
      "searchZipCode": "94102",
      "searchCity": "San Francisco",
      "searchLatitude": 37.7749,
      "searchLongitude": -122.5678,
      "userZipCode": "94102",
      "userCity": "San Francisco",
      "userLatitude": 37.7749,
      "userLongitude": -122.5678
    }
  ],
  "totalCount": 1523
}
```

### GET /analytics/heatmap

Geographic points (latitude/longitude) representing where searches originated, weighted by search volume — useful for rendering a heatmap.

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/heatmap?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  { "lng": -122.41942, "lat": 37.77493, "weight": 15 }
]
```

### GET /analytics/area-searches

Search volume and zero-result rate, grouped by ZIP code and by county.

**Query parameters:** `start`, `end` (required), `websiteIds` (optional).

```bash
curl -X GET 'https://<host>/analytics/area-searches?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
{
  "zipCodeRows": [
    { "area": "55101", "totalSearches": 50, "zeroSearches": 5, "zeroRate": 0.1 }
  ],
  "countyRows": [
    { "area": "Ramsey", "totalSearches": 120, "zeroSearches": 8, "zeroRate": 0.067 }
  ]
}
```

### GET /analytics/event-values

Distinct values recorded for a given event property — useful for building custom reports off of an event in your [event catalog](#get-analyticsevent-catalog).

**Query parameters:** `start`, `end` (required), `websiteIds` (optional), `event` (required — event name), `property` (required — property name).

```bash
curl -X GET 'https://<host>/analytics/event-values?start=2025-01-01T00:00:00Z&end=2025-01-31T23:59:59Z&event=search_zero_results&property=query' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  { "value": "homeless shelter", "total": 42 }
]
```

### GET /analytics/event-catalog

Lists all event names recorded for your tenant over roughly the last year, along with their available properties — a discovery endpoint to help you find valid `event`/`property` combinations for [`GET /analytics/event-values`](#get-analyticsevent-values). This includes both built-in events and any custom events you've sent via [`POST /analytics/events`](#post-analyticsevents).

**Query parameters:** none (uses all websites associated with your tenant).

```bash
curl -X GET 'https://<host>/analytics/event-catalog' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>'
```

**Response:**

```json
[
  {
    "eventName": "search_zero_results",
    "properties": ["query", "queryLabel", "userCoordinates"]
  }
]
```

### POST /analytics/events

Send a single custom event, e.g. to track an interaction not already covered by the [built-in metrics](#appendix-built-in-tracked-metrics).

**Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `websiteId` | string (UUID) | Yes | Must be a website ID associated with your tenant. |
| `payload.name` | string (1–255 chars) | Yes | Event name. |
| `payload.data` | object | No | Arbitrary key-value metadata for the event. |
| `payload.timestamp` | string (ISO-8601) | Yes | When the event occurred. |

```bash
curl -X POST 'https://<host>/analytics/events' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "websiteId": "550e8400-e29b-41d4-a716-446655440000",
    "payload": {
      "name": "resource_viewed",
      "data": { "resourceId": "123", "resourceType": "library" },
      "timestamp": "2024-06-26T15:00:00.000Z"
    }
  }'
```

**Response:**

```json
{ "success": true }
```

### POST /analytics/events/batch

Send up to 100 custom events in a single request.

**Body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `events` | array (max 100) | Yes | Array of `{ websiteId, payload }` objects, same shape as [`POST /analytics/events`](#post-analyticsevents). |

```bash
curl -X POST 'https://<host>/analytics/events/batch' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: <tenant-id>' \
  -H 'x-analytics-api-key: <api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "events": [
      {
        "websiteId": "550e8400-e29b-41d4-a716-446655440000",
        "payload": {
          "name": "resource_viewed",
          "data": { "resourceId": "123" },
          "timestamp": "2024-06-26T15:00:00.000Z"
        }
      }
    ]
  }'
```

**Response:**

```json
{
  "success": true,
  "processed": 10,
  "errors": 0,
  "details": []
}
```

If some events fail, `success` will be `false`, `errors` will be nonzero, and `details` will list the failing indices with an error message for each.

---

## Appendix: built-in tracked metrics

[`GET /analytics/metrics`](#get-analyticsmetrics) returns the following aggregated counts for the requested date range:

| Field | Description |
|---|---|
| `searches` | Total number of search queries performed |
| `resourceViews` | Total number of resource detail views |
| `zeroResults` | Number of searches that returned zero results |
| `directions` | Number of times directions were requested |
| `phoneCalls` | Number of phone call interactions initiated |
| `websiteClicks` | Number of website link clicks from resource listings |
| `smsClicks` | Number of SMS interactions initiated |
| `widgetSearches` | Number of searches performed via the embedded widget |
| `calloutClicks` | Number of callout/banner link clicks |
| `languageSwitches` | Number of times users switched language |
| `resourceViewed` | Number of times a resource was viewed via an event |
| `safeExitClicks` | Number of safe exit link clicks |
| `favoriteAddToList` | Number of favorites added to a list |
| `highlightClicks` | Number of highlight clicks |
| `alertClicks` | Number of alert clicks |
