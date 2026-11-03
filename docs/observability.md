# Observability — traces, logs, metrics (Norse API)

How Norse API reports telemetry: what it samples, which resource attributes identify a
process, how the environment is expressed, what a log line contains, and the privacy
rules that keep search text out of every signal.

Metrics are documented separately in [metrics.md](metrics.md). Tracing setup lives in
[src/tracing.ts](../src/tracing.ts); logging setup in
[src/common/logger/logger-config.ts](../src/common/logger/logger-config.ts).

## Signals at a glance

| Signal  | Path                         | Destination                                                     |
| ------- | ---------------------------- | --------------------------------------------------------------- |
| Traces  | OTLP/HTTP (`/v1/traces`)     | `kube-prometheus-stack-alloy-otlp.monitoring.svc:4318` → Tempo |
| Logs    | stdout (JSON, one per line)  | Alloy DaemonSet → Loki                                          |
| Metrics | `GET /metrics` (Prometheus)  | ServiceMonitor scrape → Prometheus                              |

Logs are **never** exported over OTLP and metrics are **never** pushed: the collector
reads stdout, Prometheus scrapes the endpoint. See [metrics.md](metrics.md) for the
scrape configuration.

## Sampling model

The SDK uses `ParentBasedSampler` with a `TraceIdRatioBasedSampler` root and
`AlwaysOn` for `remoteParentSampled`:

- A request that arrives with a `traceparent` keeps the caller's decision. Norse sends
  `-01` (sampled) or `-00` (unsampled), so `norse-app` → `norse-api` is one trace or
  none — never a truncated one.
- Requests without a header (direct API calls) start a new trace and are sampled at the
  root ratio, `OTEL_TRACES_SAMPLER_ARG` (default `1.0`).
- Envoy edge tracing samples header-less requests at 100%, so in practice every request
  is traced.
- `OTEL_TRACES_SAMPLER_ARG=1.0` in **both** production and dev. The sampler must stay
  `ParentBasedSampler`; changing it breaks parent-child trace continuity from Norse.

The exporter URL is `${OTEL_EXPORTER_OTLP_ENDPOINT without trailing slash}/v1/traces`,
unless `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set, which is honoured verbatim. Optional
basic auth comes from `OTEL_EXPORTER_OTLP_USERNAME`/`OTEL_EXPORTER_OTLP_PASSWORD`; the
in-cluster Alloy endpoint needs no auth. If no endpoint is configured, tracing is
disabled and the service still starts.

## Resource attributes

One cluster, two namespaces: `service.name` is `norse-api` in **both**, and only
`deployment.environment.name` distinguishes them. Never name the service
`norse-api-dev`.

| Attribute                      | Value                                                             |
| ------------------------------ | ----------------------------------------------------------------- |
| `service.name`                 | `norse-api` (constant; `OTEL_SERVICE_NAME` does not override it)   |
| `service.version`              | `APP_VERSION` env, else `package.json` version                     |
| `deployment.environment.name`  | `DEPLOYMENT_ENVIRONMENT` env; `unknown` when unset (startup warning) |
| `service.instance.id`          | `HOSTNAME` (pod name), else a random UUID                          |

`defaultResource()` is merged in, so `OTEL_RESOURCE_ATTRIBUTES` and the SDK's detected
host attributes (e.g. `host.name`, `process.pid`) are still present.

There is **no `production` fallback**: an unset `DEPLOYMENT_ENVIRONMENT` yields
`deployment.environment.name=unknown` and one startup warning
(`DEPLOYMENT_ENVIRONMENT is not set: ...`). Both namespaces must set the variable in the
deployment (the chart renders `env` from values, so an empty `env: []` means `unknown`).

## Environment convention

The environment is expressed per signal, never in the service name:

| Signal  | Field                                      | Values                    |
| ------- | ------------------------------------------ | ------------------------- |
| Traces  | resource `deployment.environment.name`     | `production`, `dev`       |
| Logs    | Loki detects `service_name` from the pod label and `namespace` | `norse-api`, `norse-api-dev` |
| Metrics | Prometheus label `env` (set by the ServiceMonitor) | `production`, `dev` |

Pods must carry the label `app.kubernetes.io/name: norse-api`. The ServiceMonitor
selects on it (see [metrics.md](metrics.md)), so a pod without the label is never
scraped: `up{job="norse-api"}` has no series for it.

Logs stay reachable. The Alloy relabel rule that builds `service_name` prefers
`app.kubernetes.io/name` and falls back to the pod's container name, so
`{service_name="norse-api"}` still matches as long as the container is named
`norse-api` (the chart names it that; renaming the container would move its streams to
the new `service_name` value). What the missing label costs in Loki is the
`app_kubernetes_io_name` stream label and every query that selects on it — the log
scope itself does not disappear.

## Log fields

NestJS logs through `nestjs-pino`. Each line is one JSON object on stdout:

| Field                                   | Meaning                                                        |
| --------------------------------------- | -------------------------------------------------------------- |
| `level`                                 | String label (`error`, `warn`, `info`, `debug`, `trace`)       |
| `time`                                  | ISO 8601 timestamp                                             |
| `msg`                                   | Message (`messageKey: 'msg'`)                                  |
| `trace_id`, `span_id`, `trace_flags`    | Present only when a valid span is active; snake_case for the collector and Grafana trace↔log links |
| `req.method`, `req.url`, `req.id`, `req.tenant_id` | Request serializer: `req.url` is the **path only** |

`LOG_LEVEL` (`error|warn|log|debug|verbose`, default `warn`) maps to pino levels
(`log` → `info`, `verbose` → `trace`). Per-request access logging is off
(`autoLogging: false`); services log what matters. `/health` and `/metrics` requests are
not traced.

Redacted paths (`[redacted]`): `req.headers.authorization`, `req.headers["x-api-key"]`,
`req.headers["x-internal-api-key"]`, `req.headers.cookie`, `req.query`,
`req.params.query`. Never log API keys, tokens, cache keys, search text or full URLs
with query strings.

## URL privacy rules

This service fronts a crisis-services directory: search text, locations, coordinates
and client identifiers are sensitive. The hard rule is that telemetry carries no query
strings at all — for incoming server spans **and** outgoing client spans (Elasticsearch,
ML Broker, geocoding, Umami, c211-auth can all carry search text):

| Attribute     | Value                                                    |
| ------------- | -------------------------------------------------------- |
| `http.target` | path only                                                |
| `url.path`    | path only                                                |
| `url.query`   | never present on an exported span (see the layers below) |
| `http.url`    | `origin + path`                                          |
| `url.full`    | `origin + path`                                          |

Both old (`http.target`/`http.url`) and stable (`url.path`/`url.query`/`url.full`)
attributes are overwritten so no query survives under either convention. Two layers do
this, and both are needed:

1. **Request hooks.** `buildServiceInstrumentations()` registers
   `sanitizeRequestUrlAttributes` as the `requestHook` of
   `@opentelemetry/instrumentation-http` and `@opentelemetry/instrumentation-undici`.
   The hook runs when the span starts and overwrites `url.path`, `url.query`
   (`""`), `http.target`, `http.url` and `url.full` with the path-only form, so those
   two instrumentations never write the query string in the first place — incoming
   server spans and outgoing `fetch`/undici client spans alike (OpenCage sends the
   geocoded address and the API key in its query string).
2. **Exporter backstop.** The process wraps its OTLP exporter in
   `SanitizingSpanExporter` ([src/tracing-sanitizing-exporter.ts](../src/tracing-sanitizing-exporter.ts)),
   which sanitises **every** span on the way out: it strips the query string and the
   fragment from `url.full`, `http.url`, `http.target` and from the span name, and
   deletes `url.query` outright (an empty value is still a place to look). No request
   hook can do this for `@opentelemetry/instrumentation-nestjs-core`, which sets
   `url.full = req.originalUrl` on each `Controller.method` span
   (`nestjs.type=request_context`); the hook does not see that span, the exporter does.
   That is also why the rule still holds when `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
   points straight at Tempo: no collector, and therefore no collector privacy
   processor, is in the path.

`src/tracing-nestjs-privacy.spec.ts` drives `buildServiceInstrumentations()` plus the
real exporter wrapper through `GET /search?query=PRIVATE-SEARCH-TEXT` and asserts the
query survives in no attribute and no span name.

The same rule applies to log fields, span names, and metric labels: bounded enums only,
no search text, locations, coordinates, client IPs, API keys, cache keys or full URLs.

## Environment variables

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://kube-prometheus-stack-alloy-otlp.monitoring.svc:4318
OTEL_TRACES_SAMPLER_ARG=1.0
DEPLOYMENT_ENVIRONMENT=production   # required; dev namespace: dev (unset -> unknown)
APP_VERSION=<image tag>
PROMETHEUS_METRICS_ENDPOINT_ENABLED=true
# removed: PROMETHEUS_PUSHGATEWAY_URL, PROMETHEUS_PUSHGATEWAY_USERNAME/PASSWORD, PROMETHEUS_PUSH_*
```

Optional: `PROMETHEUS_METRICS_TOKEN` (bearer token for `/metrics`),
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (overrides the derived traces URL),
`OTEL_EXPORTER_OTLP_USERNAME`/`OTEL_EXPORTER_OTLP_PASSWORD` (basic auth),
`LOG_LEVEL`, `HOSTNAME` (set by Kubernetes).

## Verifying a deployment

- Traces: `{ resource.service.name = "norse-api" && (span.http.target =~ ".*\\?.*" || span.url.query != "" || span.url.full =~ ".*\\?.*") }`
  in Tempo must return nothing. `url.full` is in the check on purpose: it is the
  attribute `instrumentation-nestjs-core` fills from `req.originalUrl` on
  `Controller.method` spans, and the only span the request hooks cannot reach.
- Logs: `{namespace="norse-api-dev", service_name="norse-api"} | json | trace_id != ""`
  returns lines, and `|~ "query="` returns nothing.
- Metrics: `up{job="norse-api"}` is `1` in both namespaces.
- Dependencies: `bash scripts/check-deprecated.sh` must pass; the CI deploy job runs it
  before building the image.

## Deprecations

Every direct dependency's locked version must be free of npm deprecation warnings.
`scripts/check-deprecated.sh` checks `package.json` against `package-lock.json` using
`npm view <pkg>@<version> deprecated`, and the deploy workflow fails before building if
a hit is found. It iterates the keys of `dependencies` and `devDependencies`, so
transitive packages are out of scope by design — fix one by bumping the dependency that
pulls it in, or with an `overrides` entry, not by allowlisting it. Exceptions live in
`scripts/deprecated-allowlist.txt` (one direct dependency per line, with a comment
saying why and what would unblock it) — see
[AGENTS.md](../AGENTS.md#dependency-deprecation-rule).

NestJS 10 is unmaintained; new packages must stay NestJS 10-compatible
(`@nestjs/* ^10.4`) until the framework upgrade.
