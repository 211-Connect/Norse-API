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
and no lost updates. No TTL: at most 6 documents per tenant per hour.

## Endpoints

| Route | Guard | Purpose |
| --- | --- | --- |
| `POST /internal/blocked-traffic` | `InternalApiGuard` + `TenantMiddleware` | Norse pushes `{ buckets: [{ hour, classification, enforced, count }] }` (≤ 500). Buckets must start on a UTC hour, be at most 7 days old and not in the future (5 min clock skew allowed); a bad bucket rejects the whole push with `400`. Returns `{ recorded }`. |
| `GET /analytics/blocked-traffic?start&end` | `AnalyticsApiKeyGuard` (like every `/analytics/*` route) | Totals (`blocked`, `notEnforced`), `byClassification` (always all three) and the non-empty `hourly` buckets. `start` is rounded down to its hour; the hour containing `end` is included. Same range rules as other analytics queries (≤ 365 days, not in the future). |

Code: [blocked-traffic-internal.controller.ts](../src/analytics/blocked-traffic-internal.controller.ts),
[analytics.controller.ts](../src/analytics/analytics.controller.ts) (`getBlockedTraffic`),
[blocked-traffic.service.ts](../src/analytics/services/blocked-traffic.service.ts).

## Limits

- Counts are best effort. A push that fails is retried by Norse on its next
  minute; one that times out after it was applied can be counted twice.
  Up to one minute of counts per Norse instance can be lost on a crash.
- Only routes that Norse protects with `protectPage` are counted.
