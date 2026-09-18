# Metrics — Prometheus Push (Norse API)

This file documents how Norse API emits metrics, what each metric means, and the
cardinality rules that keep the Prometheus server affordable.

## Push architecture

NestJS app instances push to **one** Prometheus Pushgateway:

- Single DigitalOcean App Platform app running N instances of the service.
- Pushgateway is deployed via the `prometheus-community` Helm chart (pushgateway v1.11.2).
- Prometheus scrapes the gateway; the app never exposes a scrape endpoint.
- Each instance pushes every `PROMETHEUS_PUSH_INTERVAL_MS` (default **15s**, set via the
  `PROMETHEUS_PUSH_INTERVAL_MS` env var).
- Each instance pushes under its **own group** so per-replica series don't overwrite each
  other. Push URL path:

  ```
  /metrics/job/norse_api/instance=<hostname>:<pid>
  ```

### Group lifecycle

- Each instance **PUTs** (Pushgateway `push` semantics) to its own group — a push replaces
  the whole group, so a restarted instance cannot leave stale series from a previous life.
- On graceful shutdown (SIGTERM; shutdown hooks are enabled in `main.ts`) the instance
  pushes final counter values and then **deletes its group**.
- History is kept in **Prometheus**, not in the gateway — configure Prometheus retention
  to at least **7 days** so weekly dashboard views keep working. Deleting a gateway group
  does not remove scraped history.
- Deleting the group on shutdown means up to **one push interval** of final increments may
  be lost (whatever happened between the last periodic push and shutdown).
- Instances that die hard (OOM kill, SIGKILL, node crash) never run the shutdown path and
  leave a **stale group** behind. Prometheus keeps scraping it until the group is removed.
  Delete it manually:

  ```bash
  curl -X DELETE <gateway>/metrics/job/norse_api/instance/<hostname>:<pid>
  ```

  or run a cleanup cron that deletes groups whose `push_time_seconds` is older than a
  few push intervals. **There is no `--metric.ttl` flag in upstream Pushgateway** —
  groups are never expired automatically.

- The Prometheus **scrape job for the Pushgateway must set `honor_labels: true`**;
  otherwise Prometheus renames the pushed `instance` label to `exported_instance` and
  per-instance groups collapse into the scrape target's `instance`.

Push self-observability: `norse_metrics_push_success_timestamp_seconds` (Gauge) records the
Unix timestamp of the last successful push and `norse_metrics_push_failures_total` (Counter)
counts failed pushes. **Alert when the timestamp is older than ~3x the push interval** — that
means an instance stopped shipping metrics. Note this alert also fires for **crashed
instances** (no shutdown hook ran) until their stale group is deleted (see above).

## Metric inventory

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `norse_http_requests_total` | Counter | `method`, `handler`, `status`, `tenant_id`, `domain` | Auto-recorded by `MetricsInterceptor` for every route **without** `@SkipMetrics()`. `handler` is `ClassName.methodName`; `domain` is the controller class name lowercased with the `Controller` suffix stripped (e.g. `search`, `resource`, `organization`) — it exists for convenient `sum by (domain)` queries; `tenant_id` is the validated `x-tenant-id` header or `unknown`. |
| `norse_http_request_duration_seconds` | Histogram | `method`, `handler` | HTTP request duration. Buckets: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`. Deliberately **no** `tenant_id`/`status` labels (cardinality). |
| `norse_downstream_requests_total` | Counter | `dependency`, `operation`, `outcome` | Calls to downstream dependencies (`dependency` values: `elasticsearch`, `ml_broker`, `mapbox`, `opencage`, `umami`, `embedding`, `cms`). `outcome`: `ok` \| `timeout` \| `error`. `timeout` = the thrown error's `name` is `TimeoutError` or `AbortError` (native fetch abort/timeout, elasticsearch `TimeoutError`); `error` = any other thrown error **or** a non-2xx HTTP response (via the per-call classifier); `ok` = success. |
| `norse_downstream_duration_seconds` | Histogram | `dependency`, `operation` | Downstream call duration, same buckets as the HTTP histogram. |
| `norse_cache_requests_total` | Counter | `cache`, `result` | Cache accesses. `cache` names the cache; `result`: `hit` \| `miss` \| `coalesced` \| `get-error`. |
| `norse_metrics_push_success_timestamp_seconds` | Gauge | — | Unix timestamp of the last successful Pushgateway push from this instance. |
| `norse_metrics_push_failures_total` | Counter | — | Failed Pushgateway pushes from this instance. |

### Elasticsearch `operation` values

All static and bounded; the per-tenant query text never enters labels:

| Operation | Call site |
| --- | --- |
| `resources_match_all`, `resources_keyword`, `resources_taxonomy`, `resources_more_like_this`, `resources_hybrid` | `SearchService.searchResources()` (by `QUERY_TYPE`) |
| `hybrid_search` | `HybridSearchService.searchHybrid()` |
| `hybrid_documents_count` | `HybridSearchService.getDocumentsCount()` |
| `taxonomy_knn` | `HybridSearchService.getTaxonomyCodes()` |
| `organization_search` | `OrganizationService.search()` |
| `taxonomy_search` | `TaxonomyService.searchTaxonomies()` |
| `taxonomy_terms_by_codes` | `TaxonomyService.getTaxonomyTermsForCodes()` |
| `scorecard_taxonomy_search` | `TaxonomyScorecardService.searchTaxonomies()` |
| `scorecard_prefix_codes` | `TaxonomyScorecardService.findAffectedCodesByPrefix()` |

Search calls by type:

```promql
sum by (operation) (increase(norse_downstream_requests_total{dependency="elasticsearch", operation=~"resources_.*|hybrid_search"}[7d]))
```

## HTTP counter caveats

- Requests rejected **before the interceptor runs** are not counted: `TenantMiddleware`
  400s, global guard 401/403 (gateway auth), and Arcjet 429s. The counter measures
  requests that reached a route handler pipeline.
- Status `499` (nginx convention) means the **client disconnected** before the response
  completed (subscriber gone / connection dropped).

## Cache metric caveats

A Redis GET failure records `get-error` **and then** `miss` for the same access (a failed
get always falls through to the miss path). Therefore compute the hit ratio as
`hit / (hit + miss + coalesced)` and **do not** add `get-error` to the denominator.

## Cardinality rules

Label values must stay bounded:

- **Allowed**: bounded enums (`method`, static `operation` strings), class/method names
  (`handler`), validated UUIDs (`tenant_id`).
- **Forbidden**: URL paths, query params, search terms, or free-form ids in labels.
- **Histograms never carry `tenant_id`** — a UUID label on every bucket of every series
  multiplies storage by tenant count.

If you add a new metric or label, verify the value space is bounded *before* shipping it.

## PromQL examples

Requests per tenant:

```promql
sum by (tenant_id) (rate(norse_http_requests_total[5m]))
```

5xx error ratio per tenant:

```promql
  sum by (tenant_id) (rate(norse_http_requests_total{status=~"5.."}[5m]))
/
  sum by (tenant_id) (rate(norse_http_requests_total[5m]))
```

p95 latency per handler:

```promql
histogram_quantile(0.95, sum by (handler, le) (rate(norse_http_request_duration_seconds_bucket[5m])))
```

## Migration note

`norse_search_hits_total` and `norse_resource_hits_total` were **removed** and replaced by
`norse_http_requests_total` (organization hits were previously mislabeled under
`norse_search_hits_total`). **Dashboards must switch** to the new metric.

## CDN effect

Endpoints decorated with `@SetCdnCacheTTL` are served from the CDN on cache hits, so
app-side counters measure **origin requests, not total traffic**. Do not use
`norse_http_requests_total` as a user-traffic count for those endpoints.
