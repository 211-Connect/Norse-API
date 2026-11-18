# Crawler traffic counts

Hourly, per-tenant counts of the crawler requests Norse sees, per crawler
name and outcome. Umami never sees these requests: most crawlers run no
JavaScript, and blocked requests get a 403 before the page renders. This
store feeds two Payload dashboard widgets (per tenant), **Crawler traffic** (chart and
top crawlers) and **Blocked Bots** (stat card, see
[blocked-traffic.md](blocked-traffic.md)).

Norse does the counting. Each Norse instance keeps in-memory counters and
pushes the deltas here once a minute. The write rate is about
`instances × active tenants` small requests per minute, however many bots
hit the site. The Norse side is documented in the Norse repo, in
`docs/blocked-traffic-analytics.md` and `docs/load-shedding.md`.

## Storage

MongoDB collection `crawler_traffic_hourly`
([src/common/schemas/crawler-traffic-hourly.schema.ts](../src/common/schemas/crawler-traffic-hourly.schema.ts)),
one document per bucket:

| Field | Meaning |
| --- | --- |
| `tenantId` | Norse tenant (from `x-tenant-id` of the push) |
| `hour` | start of the UTC hour |
| `crawler` | Arcjet bot name, e.g. `GOOGLE_CRAWLER`; `''` when none is known (rate-limited and load-limited requests) |
| `outcome` | `blocked` (403), `rate_limited` (403 from the per-IP limit), `logged` (denied on an observe-only host, served), `allowed` (an allowed crawler, served), `shed` (429 from a per-tenant load limit) |
| `classification` | `seo` \| `nefarious` \| `unknown` (rules live in Norse `src/lib/arcjet-classification.ts`) |
| `count` | requests in the bucket |

- **Index:** a unique index on
  `{ tenantId, hour, crawler, outcome, classification }`. Its
  `{ tenantId, hour }` prefix also serves the range reads.
- **Writes:** `updateOne` + `$inc` + `upsert` in one unordered
  `bulkWrite`. Pushes from several Norse instances for the same bucket add
  up, with no read-modify-write and no lost updates.
- **Retention:** kept forever (no TTL). A tenant-hour holds a few dozen
  documents at most (one per crawler and outcome seen), about 100 bytes each.

"Enforced" (what the Blocked Bots card counts) means `blocked` or
`rate_limited`. "Not enforced" means `logged`.

## Endpoints

| Route | Guard | Purpose |
| --- | --- | --- |
| `POST /internal/crawler-traffic` | `InternalApiGuard` + `TenantMiddleware` | Norse pushes `{ buckets: [{ hour, crawler, outcome, classification, count }] }` (at most 1,000). See the push rules below. Returns `{ recorded }`. |
| `GET /analytics/crawler-traffic?start&end[&granularity=hour\|day]` | `AnalyticsApiKeyGuard` (like every `/analytics/*` route) | One tenant's data, described below. |

Push rules for `POST /internal/crawler-traffic`:

- each bucket must start on a UTC hour;
- at most 7 days old, and not in the future (5 min clock skew allowed);
- `crawler` matches `^[A-Z0-9_]*$` (at most 64 characters);
- one bad bucket rejects the whole push with `400`.

`GET /analytics/crawler-traffic` returns:

- `totals` per outcome and in total;
- `byCrawler`: the top 100 crawlers, with counts per outcome;
- `series`: one point per hour or per day, with counts per outcome; empty
  buckets are left out.

Range and granularity rules:

- `start` is rounded down to its hour, and the hour containing `end` is
  included.
- The same range rules as other analytics queries apply: at most 365 days,
  not in the future.
- `granularity=hour` is allowed only for ranges up to 31 days (400
  otherwise). The default is `day`.
- Days are UTC days.

All of it comes from one `$facet` aggregation.

Code:

- [crawler-traffic-internal.controller.ts](../src/analytics/crawler-traffic-internal.controller.ts)
- [analytics.controller.ts](../src/analytics/analytics.controller.ts) (`getCrawlerTraffic`)
- [crawler-traffic.service.ts](../src/analytics/services/crawler-traffic.service.ts)

## Load

- **Writes:** one `bulkWrite` per tenant with traffic, per Norse instance,
  per minute. For example, 3 instances × 30 tenants is about 1.5 requests/s,
  whatever the bot volume.
- **Reads:** a range scan on the unique index prefix `{ tenantId, hour }`.
  Responses carry the analytics CDN `Cache-Control`, with a long TTL for
  closed ranges.

## Limits

- Counts are best effort. Norse retries a failed push on its next minute,
  so a push that was applied but reported a failure (a timeout, or a
  partial unordered `bulkWrite` failure) is counted twice.
- Up to one minute of counts per Norse instance can be lost on a crash.
- Requests on a host that matches no Norse tenant are counted for the
  "unknown" tenant `00000000-0000-0000-0000-000000000000` (nil UUID).
- Only crawlers Arcjet identifies get a name. Unidentified clients that
  Arcjet allowed are not counted at all.
