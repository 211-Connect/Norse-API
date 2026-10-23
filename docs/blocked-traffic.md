# Blocked traffic counts (ISS-2366)

Hourly, per-tenant counts of requests that Norse's Arcjet bot protection
denied. These requests get a 403 before the page renders, so Umami never
sees them; this store is what the Payload **Blocked Bots** widget reads, so
a tenant sees "N page views, and M requests were blocked bots" instead of an
unexplained change.

Norse does the counting. Each Norse instance keeps in-memory counters and
pushes the deltas here once a minute, so the write rate is about
`instances × active tenants` small requests per minute, independent of how
many bots hit the site (~15 denials/s in October 2026). The Norse side is
documented in the Norse repo, `docs/blocked-traffic-analytics.md`.

## Storage

MongoDB collection `blocked_traffic_hourly`
([src/common/schemas/blocked-traffic-hourly.schema.ts](../src/common/schemas/blocked-traffic-hourly.schema.ts)),
one document per bucket:

| Field | Meaning |
| --- | --- |
| `tenantId` | Norse tenant (from `x-tenant-id` of the push) |
| `hour` | start of the UTC hour |
| `classification` | `seo` \| `nefarious` \| `unknown` (rules live in Norse `src/lib/arcjet-classification.ts`) |
| `enforced` | `true`: the request got a 403. `false`: observe-only host (e.g. MBOA), detected but served |
| `count` | denials in the bucket |

Unique index `{ tenantId, hour, classification, enforced }`. Writes are
`updateOne` + `$inc` + `upsert` in one unordered `bulkWrite`, so pushes from
several Norse instances for the same bucket add up with no read-modify-write
and no lost updates.

Retention: 2 years. A TTL index on `hour` (`expireAfterSeconds`,
`BLOCKED_TRAFFIC_RETENTION_SECONDS`) lets MongoDB delete older buckets, so
a season can be compared with the year before. A range that reaches back
further reads as 0 for the expired part. Mongoose never updates an
existing TTL index: to change the period on a deployed database, change the
constant and run `collMod` on the index (command in the schema file).

## Endpoints

| Route | Guard | Purpose |
| --- | --- | --- |
| `POST /internal/blocked-traffic` | `InternalApiGuard` + `TenantMiddleware` | Norse pushes `{ buckets: [{ hour, classification, enforced, count }] }` (≤ 500). Buckets must start on a UTC hour, be at most 7 days old and not in the future (5 min clock skew allowed); a bad bucket rejects the whole push with `400`. Returns `{ recorded }`. |
| `GET /analytics/blocked-traffic?start&end[&hourly=true]` | `AnalyticsApiKeyGuard` (like every `/analytics/*` route) | Totals (`blocked`, `notEnforced`) and `byClassification` (always all three), grouped in MongoDB (`$group`, ≤ 6 rows back whatever the range). The non-empty `hourly` buckets only with `hourly=true` (a 365-day range can hold ~50k of them; the widget does not ask). `start` is rounded down to its hour; the hour containing `end` is included. Same range rules as other analytics queries (≤ 365 days, not in the future). |

Code: [blocked-traffic-internal.controller.ts](../src/analytics/blocked-traffic-internal.controller.ts),
[analytics.controller.ts](../src/analytics/analytics.controller.ts) (`getBlockedTraffic`),
[blocked-traffic.service.ts](../src/analytics/services/blocked-traffic.service.ts).

## Load

- Writes: one `bulkWrite` of ≤ 6 upserts per tenant with denials, per Norse
  instance, per minute — e.g. 3 instances × 30 tenants ≈ 1.5 requests/s,
  independent of bot volume.
- Size: ≤ 6 documents per tenant-hour, ~100 bytes each: worst case ~105k
  documents (~10 MB) per tenant at the 2-year retention.
- Reads: both queries are a range scan on the unique index prefix
  `{ tenantId, hour }`; a year of one tenant is at most ~50k index entries.
  Responses carry the analytics CDN `Cache-Control` (long TTL for closed
  ranges).

## Limits

- Counts are best effort. A push that fails is retried by Norse on its next
  minute, so a push that was applied but still reported a failure is
  counted twice:
  - a timeout after MongoDB applied it;
  - a partial `bulkWrite` failure: with `ordered: false` the operations
    that succeed are applied and the call still throws, Norse resends the
    whole push, and the applied buckets are counted again.
- Up to one minute of counts per Norse instance can be lost on a crash.
- Denials on a host that matches no Norse tenant are counted for the
  "unknown" tenant `00000000-0000-0000-0000-000000000000` (nil UUID), so
  they stay visible here instead of being dropped.
- Only routes that Norse protects with `protectPage` are counted.
