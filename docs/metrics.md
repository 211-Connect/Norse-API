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

- Recommend running the gateway with the `--metric.ttl` flag set to a few multiples of the
  push interval, so groups from dead/scaled-down replicas age out instead of lingering
  forever.

Push self-observability: `norse_metrics_push_success_timestamp_seconds` (Gauge) records the
Unix timestamp of the last successful push and `norse_metrics_push_failures_total` (Counter)
counts failed pushes. **Alert when the timestamp is older than ~3x the push interval** — that
means an instance stopped shipping metrics.

## Metric inventory

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `norse_http_requests_total` | Counter | `method`, `handler`, `status`, `tenant_id`, `domain` | Auto-recorded by `MetricsInterceptor` for every route **without** `@SkipMetrics()`. `handler` is `ClassName.methodName`; `domain` is the controller class name lowercased with the `Controller` suffix stripped (e.g. `search`, `resource`, `organization`); `tenant_id` is the validated `x-tenant-id` header or `unknown`. |
| `norse_http_request_duration_seconds` | Histogram | `method`, `handler` | HTTP request duration. Buckets: `[0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]`. Deliberately **no** `tenant_id`/`status` labels (cardinality). |
| `norse_downstream_requests_total` | Counter | `dependency`, `operation`, `outcome` | Calls to downstream dependencies (`dependency` values: `elasticsearch`, `ml_broker`, `mapbox`, `opencage`, `umami`). `outcome`: `ok` \| `timeout` \| `error`. `timeout` = downstream call mapped to a 503; `error` = anything else. |
| `norse_downstream_duration_seconds` | Histogram | `dependency` | Downstream call duration, same buckets as the HTTP histogram. |
| `norse_cache_requests_total` | Counter | `cache`, `result` | Cache accesses. `cache` names the cache; `result`: `hit` \| `miss` \| `coalesced` \| `get-error`. |
| `norse_metrics_push_success_timestamp_seconds` | Gauge | — | Unix timestamp of the last successful Pushgateway push from this instance. |
| `norse_metrics_push_failures_total` | Counter | — | Failed Pushgateway pushes from this instance. |

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
