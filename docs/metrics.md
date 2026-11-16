# Metrics — Prometheus (Norse API)

This file documents how Norse API emits metrics, what each metric means, and the
cardinality rules that keep the Prometheus server affordable.

## Delivery mode

Prometheus scrapes `GET /metrics` on every pod through a `ServiceMonitor`. The
app is scrape-only: it never pushes metrics.

Environment variables:

- `PROMETHEUS_METRICS_ENDPOINT_ENABLED=true` — serves `GET /metrics`
  (default: disabled, so the endpoint stays inert where Prometheus does not
  scrape it).
- `PROMETHEUS_METRICS_TOKEN` — optional; when set, `/metrics` requires
  `Authorization: Bearer <token>` (constant-time comparison).

The Prometheus scrape adds the `instance`, `pod`, and `namespace` target labels,
so the app does not add them itself. The ServiceMonitor sets `job` to
`norse-api` and `env` to `production` or `dev`.

`/metrics` and `/health` requests are not traced.

Alert on `up == 0` for the scrape target.

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
      relabelings:
        - targetLabel: job
          replacement: norse-api
        - targetLabel: env
          replacement: production # dev in the norse-api-dev namespace
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

| Env var                               | Config key                        | Default | Meaning                                                                       |
| ------------------------------------- | --------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `PROMETHEUS_METRICS_ENDPOINT_ENABLED` | `METRICS_ENDPOINT_ENABLED`        | `false` | Serve `GET /metrics` for Prometheus scraping; only `true/1/yes/on` enable it. |
| `PROMETHEUS_METRICS_TOKEN`            | `METRICS_TOKEN`                   | `''`    | Optional bearer token for `GET /metrics`.                                     |

## Metric inventory

| Metric                                         | Type      | Labels                                               | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `norse_http_requests_total`                    | Counter   | `method`, `handler`, `status`, `tenant_id`, `domain` | Auto-recorded by `MetricsInterceptor` for every route **without** `@SkipMetrics()`. `handler` is `ClassName.methodName`; `domain` is the controller class name lowercased with the `Controller` suffix stripped (e.g. `search`, `resource`, `organization`) — it exists for convenient `sum by (domain)` queries; `tenant_id` is `request.tenantId` as validated by TenantMiddleware, otherwise `unknown`.                                                                                                                                                                                                                                 |
| `norse_http_request_duration_seconds`          | Histogram | `method`, `handler`                                  | HTTP request duration. Buckets: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`. Deliberately **no** `tenant_id`/`status` labels (cardinality).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `norse_downstream_requests_total`              | Counter   | `dependency`, `operation`, `outcome`                 | Calls to downstream dependencies (`dependency` values: `elasticsearch`, `ml_broker`, `mapbox`, `opencage`, `umami`, `embedding`, `cms`). `outcome`: `ok` \| `timeout` \| `error`. `timeout` = the thrown error's `name` is `TimeoutError` or `AbortError` (native fetch abort/timeout, elasticsearch `TimeoutError`); `error` = any other thrown error **or** a non-2xx HTTP response (via the per-call classifier); `ok` = success.                                                                                                                                                                                                       |
| `norse_downstream_duration_seconds`            | Histogram | `dependency`, `operation`, `outcome`                 | Downstream call duration, same buckets as the HTTP histogram. Carries the same `outcome` (`ok` \| `timeout` \| `error`) as `norse_downstream_requests_total`, so failure latency can be measured per dependency.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `norse_search_requests_total`                  | Counter   | `tenant_id`, `locale`, `search_type`, `outcome`      | One per search HTTP request (`GET`/`POST /search`, `GET /v2/search`, `GET /organization`), recorded at the controller boundary after the request settles. `search_type` is a fixed enum: `keyword` \| `match_all` \| `taxonomy` \| `more_like_this` \| `hybrid` \| `organization` \| `v2`. `outcome`: `results` \| `zero_results` \| `error`. `locale` and `tenant_id` rules below. `/internal/*` routes are never counted. |
| `norse_resource_requests_total`                | Counter   | `tenant_id`, `locale`, `outcome`                     | One per single-resource lookup (`GET /resource/:id`, `GET /resource/original/:id`). `outcome`: `found` \| `not_found` (404) \| `error`. Never carries the resource id, query text, location or coordinates. |
| `norse_cache_requests_total`                   | Counter   | `cache`, `result`                                    | Cache accesses. `cache` names the cache; `result`: `hit` \| `miss` \| `coalesced` \| `get-error`. `cache` values are a fixed TypeScript union (`CacheName` in `src/metrics/metrics.service.ts`), so the label stays bounded: `request-redis` (RequestCacheService, Redis), `analytics-lru` (AnalyticsCacheService L1, in-process LRU), `analytics-redis` (AnalyticsCacheService L2, app Redis), `tenant-config-lru` (TenantConfigService in-process LRUs), `tenant-config-redis` (TenantConfigService CMS Redis, DB 2, written by PayloadCMS), `tenant-config-app-redis` (TenantConfigService app-Redis fallback, Keycloak realm id only). |

### Downstream duration by outcome

`norse_downstream_duration_seconds` carries the same `outcome` label as
`norse_downstream_requests_total` (both are recorded by `recordDownstream`, so they always
agree). `outcome` is the bounded enum `ok` \| `timeout` \| `error`; no other label was added,
so cardinality grows by at most 3x for this histogram.

p95 latency of failing downstream calls:

```promql
histogram_quantile(0.95, sum by (dependency, operation, le) (rate(norse_downstream_duration_seconds_bucket{outcome!="ok"}[5m])))
```

Failure share of the time spent per dependency (fraction in `[0, 1]` — failing seconds
over total seconds, both from the same histogram):

```promql
sum by (dependency) (rate(norse_downstream_duration_seconds_sum{outcome!="ok"}[5m]))
  /
sum by (dependency) (rate(norse_downstream_duration_seconds_sum[5m]))
```

The denominator is required: `_sum` alone is absolute seconds, so it only tells you how
much wall-clock time a dependency consumed, not how much of it failed.

### Downstream timeouts

The fetch-based calls below has an explicit timeout so slow downstreams surface as
`outcome="timeout"` rather than hanging:

| Dependency / operation       | Timeout                            |
| ---------------------------- | ---------------------------------- |
| `ml_broker`                  | 10s                                |
| `embedding`                  | 10s                                |
| `cms`                        | 10s                                |
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

## Usage metrics (tenant × language × outcome)

`norse_search_requests_total` and `norse_resource_requests_total` answer "how much
search/resource usage, in which language, with which result". They are recorded
**once per HTTP request** at the controller boundary (`SearchController`,
`OrganizationController`, `ResourceController`), after the request settles — never
per Elasticsearch call. Routes under `/internal/*` are not wired, so they are
excluded.

- `tenant_id`: the validated `request.tenantId` (TenantMiddleware), else `unknown`.
- `locale`: lowercase primary subtag of the highest-priority `accept-language`
  entry (`es-MX,es;q=0.9` → `es`, `ES` → `es`, `zh-Hant-TW` → `zh`). The subtag is
  allowed only when it is in the tenant's **cached** configured locales (in-process
  LRU — no Redis/CMS I/O on the request path) or in the platform locale list;
  otherwise `other`. A missing or empty header is `en`, the same default the
  services use. Script and region subtags are dropped, so `zh-Hans` and `zh-Hant`
  both become `zh`.
- `search_type` (fixed enum, derived from the code paths):
  `keyword` (text query with content), `match_all` (empty text query),
  `taxonomy`, `more_like_this`, `hybrid`, `organization` (organization typeahead,
  ES operation `organization_search`), `v2` (`GET /v2/search`, always hybrid).
- `outcome`: search `results` | `zero_results` | `error`; resource
  `found` | `not_found` | `error` (`not_found` is the 404 path only).

No query text, filters, coords, location, resource id or cache key is a label.
The platform locale list is the primary-subtag reduction of the Norse CMS locale
list (`src/payload/i18n/locales.ts`): 38 values, `zh-Hans`/`zh-Hant` collapsing
to `zh`.

### Cardinality budget

Worst case per pod, per series actually observed:

| Metric | Bound |
| --- | --- |
| `norse_search_requests_total` | tenants × locales × 6 search types × 3 outcomes |
| `norse_resource_requests_total` | tenants × locales × 3 outcomes |

The item budget assumed **50+ tenants × 13 locales × ~6 types × 3 outcomes ≈ 12k**
search series and ≈ 2k resource series. The code has **38** platform locales
(39 locale values including `other`), so the ceiling is
**50 × 39 × 6 × 3 ≈ 35k** search series and **50 × 39 × 3 ≈ 5.9k** resource
series per pod. That is still bounded by construction (no free-form label values)
and much smaller in practice: a pod only creates series for requests it serves,
per-tenant allowlists are narrower than the platform list, and not every
combination occurs. Re-check this budget before adding another label.

### PromQL

Searches per tenant and language over a week:

```promql
sum by (tenant_id, locale) (increase(norse_search_requests_total{env="production"}[7d]))
```

Zero-result share per language over a week:

```promql
sum by (locale) (increase(norse_search_requests_total{outcome="zero_results"}[7d])) / sum by (locale) (increase(norse_search_requests_total[7d]))
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

## CDN effect

Endpoints decorated with `@SetCdnCacheTTL` are served from the CDN on cache hits, so
app-side counters measure **origin requests, not total traffic**. Do not use
`norse_http_requests_total` as a user-traffic count for those endpoints.
