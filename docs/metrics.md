# Metrics — Prometheus (Norse API)

This file documents how Norse API emits metrics, what each metric means, and the
cardinality rules that keep the Prometheus server affordable.

## Delivery modes

Norse API ships metrics to Prometheus in one of two modes, chosen purely by
environment variables. The same image runs in both places; all metric names,
labels, and buckets are identical in both modes, so the same dashboards work
for both deployments.

### Push (DigitalOcean App Platform)

NestJS app instances push to **one** Prometheus Pushgateway:

- Single DigitalOcean App Platform app running N instances of the service.
- Pushgateway is deployed via the `prometheus-community` Helm chart (pushgateway v1.11.2).
- The app's scrape endpoint (`GET /metrics`) is disabled by default —
  `PROMETHEUS_METRICS_ENDPOINT_ENABLED` defaults to `false`, so the public
  endpoint is not reachable in this deployment.
- Each instance pushes every `PROMETHEUS_PUSH_INTERVAL_MS` (default **15s**, set via the
  `PROMETHEUS_PUSH_INTERVAL_MS` env var).
- Each instance pushes under its **own group** so per-replica series don't overwrite each
  other. Push URL path:

  ```
  /metrics/job/norse_api/instance/<hostname>:<pid>
  ```

### Group lifecycle

- Each instance **PUTs** (Pushgateway `push` semantics) to its own group — a push replaces
  the whole group, so series that stop being reported by this process are removed instead
  of lingering (as they would with `pushAdd`). A restarted instance gets a new
  `hostname:pid` and therefore a new group.
- On graceful shutdown (SIGTERM; shutdown hooks are enabled in `main.ts`) the instance
  pushes final counter values and then **deletes its group**. On shutdown the service
  first waits for any in-flight periodic push, then does the final push, then deletes the
  group, so a late periodic push cannot recreate a deleted group. Every Pushgateway
  request (push and delete) has a 5s timeout, so an unreachable gateway cannot block
  shutdown.
- Shutdown order: Nest runs `onModuleDestroy` (final push, then group delete) before
  `onApplicationShutdown`, where the OpenTelemetry SDK is flushed
  (`TracingShutdownService`). Nothing else may call `process.exit` on SIGTERM, or the
  group delete is skipped.
- History is kept in **Prometheus**, not in the gateway — configure Prometheus retention
  to at least **7 days** so weekly dashboard views keep working. Deleting a gateway group
  does not remove scraped history.
- The final push on shutdown captures all increments up to that moment. Only what
  Prometheus has not scraped between the final push and the group delete is lost — at
  most one Pushgateway **scrape interval**.
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

### Scrape (Kubernetes)

Prometheus Operator scrapes `GET /metrics` on each pod through a
`ServiceMonitor`. The app does **not** push in this mode.

Environment variables:

- `PROMETHEUS_PUSH_METRICS_ENABLED=false` — disables periodic Pushgateway pushes.
- `PROMETHEUS_METRICS_ENDPOINT_ENABLED=true` — serves `GET /metrics`.
- `PROMETHEUS_METRICS_TOKEN` — optional; when set, `/metrics` requires
  `Authorization: Bearer <token>` (constant-time comparison).

The Prometheus scrape adds the `instance`, `pod`, and `namespace` target labels,
so the app does not add them itself.

`/metrics` and `/health` requests are not traced.

The push self-observability metrics
(`norse_metrics_push_success_timestamp_seconds`,
`norse_metrics_push_failures_total`) are registered only when a Pushgateway URL is set and push is enabled.
In a scrape-only pod neither is true, so
push-staleness alerts do not fire for every pod. Alert on `up == 0` for the
scrape target instead. Setting `PROMETHEUS_PUSH_METRICS_ENABLED=false` is still
recommended, but leaving `PROMETHEUS_PUSHGATEWAY_URL` empty is enough to turn
push off.

ServiceMonitor example (the Service port must be named `http`):

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: norse-api
  labels:
    release: kube-prometheus-stack # must match your Prometheus serviceMonitorSelector
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: norse-api
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
      scrapeTimeout: 10s
      # Same job label as the Pushgateway series, so dashboards work for both deployments
      relabelings:
        - targetLabel: job
          replacement: norse_api
      # Only if PROMETHEUS_METRICS_TOKEN is set:
      # authorization:
      #   type: Bearer
      #   credentials:
      #     name: norse-api-metrics
      #     key: token
```

### Exposure

`/metrics` shares the app's HTTP port. In Kubernetes, do **not** route `/metrics`
through the public Ingress: either block the path at the Ingress, or rely on the
token plus a NetworkPolicy that allows only the Prometheus namespace. On
DigitalOcean, leave the endpoint disabled (the default).

## Environment variables

| Env var                                                               | Config key                                        | Default | Meaning                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `PROMETHEUS_PUSHGATEWAY_URL`                                          | `PUSH_GATEWAY_URL`                                | `''`    | Pushgateway base URL; push is only configured when set.                       |
| `PROMETHEUS_PUSH_INTERVAL_MS`                                         | `PUSH_INTERVAL_MS`                                | `15000` | Periodic push interval.                                                       |
| `PROMETHEUS_PUSHGATEWAY_USERNAME` / `PROMETHEUS_PUSHGATEWAY_PASSWORD` | `PUSH_GATEWAY_USERNAME` / `PUSH_GATEWAY_PASSWORD` | `''`    | Basic auth for the Pushgateway.                                               |
| `PROMETHEUS_PUSH_METRICS_ENABLED`                                     | `PUSH_METRICS_ENABLED`                            | `true`  | Periodic pushes; `false/0/no/off` disable.                                    |
| `PROMETHEUS_METRICS_ENDPOINT_ENABLED`                                 | `METRICS_ENDPOINT_ENABLED`                        | `false` | Serve `GET /metrics` for Prometheus scraping; only `true/1/yes/on` enable it. |
| `PROMETHEUS_METRICS_TOKEN`                                            | `METRICS_TOKEN`                                   | `''`    | Optional bearer token for `GET /metrics`.                                     |

## Metric inventory

| Metric                                         | Type      | Labels                                               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `norse_http_requests_total`                    | Counter   | `method`, `handler`, `status`, `tenant_id`, `domain` | Auto-recorded by `MetricsInterceptor` for every route **without** `@SkipMetrics()`. `handler` is `ClassName.methodName`; `domain` is the controller class name lowercased with the `Controller` suffix stripped (e.g. `search`, `resource`, `organization`) — it exists for convenient `sum by (domain)` queries; `tenant_id` is `request.tenantId` as validated by TenantMiddleware, otherwise `unknown`.                                                                                                                                                                                                                                 |
| `norse_http_request_duration_seconds`          | Histogram | `method`, `handler`                                  | HTTP request duration. Buckets: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`. Deliberately **no** `tenant_id`/`status` labels (cardinality).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `norse_downstream_requests_total`              | Counter   | `dependency`, `operation`, `outcome`                 | Calls to downstream dependencies (`dependency` values: `elasticsearch`, `ml_broker`, `mapbox`, `opencage`, `umami`, `embedding`, `cms`). `outcome`: `ok` \| `timeout` \| `error`. `timeout` = the thrown error's `name` is `TimeoutError` or `AbortError` (native fetch abort/timeout, elasticsearch `TimeoutError`); `error` = any other thrown error **or** a non-2xx HTTP response (via the per-call classifier); `ok` = success.                                                                                                                                                                                                       |
| `norse_downstream_duration_seconds`            | Histogram | `dependency`, `operation`                            | Downstream call duration, same buckets as the HTTP histogram.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `norse_cache_requests_total`                   | Counter   | `cache`, `result`                                    | Cache accesses. `cache` names the cache; `result`: `hit` \| `miss` \| `coalesced` \| `get-error`. `cache` values are a fixed TypeScript union (`CacheName` in `src/metrics/metrics.service.ts`), so the label stays bounded: `request-redis` (RequestCacheService, Redis), `analytics-lru` (AnalyticsCacheService L1, in-process LRU), `analytics-redis` (AnalyticsCacheService L2, app Redis), `tenant-config-lru` (TenantConfigService in-process LRUs), `tenant-config-redis` (TenantConfigService CMS Redis, DB 2, written by PayloadCMS), `tenant-config-app-redis` (TenantConfigService app-Redis fallback, Keycloak realm id only). |
| `norse_metrics_push_success_timestamp_seconds` | Gauge     | —                                                    | Unix timestamp of the last successful Pushgateway push from this instance. **Registered only when a Pushgateway URL is set and push is enabled** — absent in scrape mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `norse_metrics_push_failures_total`            | Counter   | —                                                    | Failed Pushgateway pushes from this instance. **Registered only when a Pushgateway URL is set and push is enabled** — absent in scrape mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Downstream timeouts

The fetch-based calls below has an explicit timeout so slow downstreams surface as
`outcome="timeout"` rather than hanging:

| Dependency / operation       | Timeout                            |
| ---------------------------- | ---------------------------------- |
| `ml_broker`                  | 10s                                |
| `embedding`                  | 10s                                |
| `cms`                        | 10s                                |
| `umami` `verify`             | 5s                                 |
| `umami` `login`              | 10s                                |
| `umami` analytics fetch/send | 60s (`ANALYTICS_FETCH_TIMEOUT_MS`) |

### Elasticsearch `operation` values

All static and bounded; the per-tenant query text never enters labels:

| Operation                                                                                    | Call site                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `resources_match_all`, `resources_keyword`, `resources_taxonomy`, `resources_more_like_this` | `SearchService.searchResources()` (by `QUERY_TYPE`)    |
| `hybrid_search`                                                                              | `HybridSearchService.searchHybrid()`                   |
| `hybrid_documents_count`                                                                     | `HybridSearchService.getDocumentsCount()`              |
| `taxonomy_knn`                                                                               | `HybridSearchService.getTaxonomyCodes()`               |
| `organization_search`                                                                        | `OrganizationService.search()`                         |
| `taxonomy_search`                                                                            | `TaxonomyService.searchTaxonomies()`                   |
| `taxonomy_terms_by_codes`                                                                    | `TaxonomyService.getTaxonomyTermsForCodes()`           |
| `scorecard_taxonomy_search`                                                                  | `TaxonomyScorecardService.searchTaxonomies()`          |
| `scorecard_prefix_codes`                                                                     | `TaxonomyScorecardService.findAffectedCodesByPrefix()` |

`query_type=hybrid` requests are delegated to `HybridSearchService.searchHybrid()` before
any `SearchService` Elasticsearch call, so they appear only as `hybrid_search`.

Search calls by type:

```promql
sum by (operation) (increase(norse_downstream_requests_total{dependency="elasticsearch", operation=~"resources_.*|hybrid_search"}[7d]))
```

## HTTP counter caveats

- Requests rejected **before the interceptor runs** are not counted: `TenantMiddleware`
  400s, global guard 401/403 (gateway auth), and Arcjet 429s. The counter measures
  requests that reached a route handler pipeline.
- Status `499` is recorded only if the response stream is cancelled without completing or
  erroring. This is a safety net: Nest's HTTP adapter does not cancel the handler when the
  client disconnects, so in practice 499 is rare and must not be used to measure client
  disconnects.
- `tenant_id` is `unknown` on tenant-agnostic controllers that don't run TenantMiddleware:
  `geocoding`, `short-url`, `cms-config`, `orchestration-config`, `analytics`,
  `taxonomy-scorecard`, and the root `AppController`. Use `domain`/`handler` to slice those.

## Cache metric caveats

- Two-tier caches record **per tier**: an L1 `analytics-lru` miss is followed by an
  `analytics-redis` lookup, so compute hit ratios **per `cache`**:

  ```promql
    sum by (cache) (rate(norse_cache_requests_total{result="hit"}[5m]))
  /
    sum by (cache) (rate(norse_cache_requests_total{result=~"hit|miss|coalesced"}[5m]))
  ```

- `tenant-config-redis` misses on every search when a tenant has no facets or locales in
  CMS Redis, because misses are not cached in the LRU.
- `tenant-config-app-redis` only applies to the Keycloak realm id fallback.

A Redis GET failure records `get-error` **and then** `miss` for the same access (a failed
get always falls through to the miss path). Therefore do **not** add `get-error` to the
denominator of the hit-ratio query above.

## Cardinality rules

Label values must stay bounded:

- **Allowed**: bounded enums (`method`, static `operation` strings), class/method names
  (`handler`), validated UUIDs (`tenant_id`).
- **Forbidden**: URL paths, query params, search terms, or free-form ids in labels.
- **Histograms never carry `tenant_id`** — a UUID label on every bucket of every series
  multiplies storage by tenant count.

If you add a new metric or label, verify the value space is bounded _before_ shipping it.

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
