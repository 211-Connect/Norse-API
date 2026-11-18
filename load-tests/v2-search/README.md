# k6 load test for `GET /v2/search`

One iteration is one search request. The load model is open (arrival rate): search traffic does not wait for answers, so the test sends the planned rate even when the server is slow. Route doc: [docs/v2-search.md](../../docs/v2-search.md).

Status: smoke only (2 runs of 4 to 5 requests against a local server). No ramp, spike or soak has run.

## What one request costs

`/v2/search` runs hybrid search, one classify call to `ml-broker`, Elasticsearch calls, and one external embedding call.

- `ml-broker`: 1 instance, 2 vCPU / 4 GB. **Dev and prod share it.** The classify timeout is 1000 ms (`V2_CLASSIFY_TIMEOUT_MS`). A classify call that fails or times out does not fail the request: the answer is 200 with `model_version: null`. That is how `ml-broker` saturation shows up, so the script counts it in its own rate, `classify_failed`.
- `relevance_cutoff=on` is very slow (2.2 s server time in one Elasticsearch call). Its share is 0 by default.
- A planned embedding cache will make repeated queries much cheaper. The script tags **popular** (repeated) and **one-off** queries apart so the two groups show apart in the results.

## Environment variables

Set only these to run. Everything else has a default.

| Variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | required | For example `http://localhost:8093`. The script adds `/v2/search`. |
| `TENANT_ID` | required | Sent as header `x-tenant-id`. The route needs no other credential on the direct path. |
| `PROFILE` | `smoke` | `smoke`, `ramp`, `spike` or `soak`. |
| `MAX_RPS` | `20` | Hard cap on any arrival rate. Ramp steps above it are dropped. The spike jumps to it. |
| `ACCEPT_LANGUAGE` | `en` | Header `accept-language`. |
| `QUERIES_FILE` | `queries.sample.json` | Query file (below). Absolute paths work. |
| `API_KEY`, `API_KEY_HEADER` | unset, `x-api-key` | Only if the target sits behind the gateway. Never logged. See "Auth". |
| `ALLOW_PROD` | unset | `yes` lets the script run against a production host. |
| `ALLOW_LOCAL_LOAD` | unset | `yes` lets a non-smoke profile run against localhost. |

### Auth

Norse-API reads `x-tenant-id` and nothing else on this route (`TenantMiddleware`; the gateway guards never deny, they classify the request). A deployment behind the Envoy gateway needs a gateway key. The gateway header name is not verified here: set `API_KEY` and `API_KEY_HEADER` to what the gateway expects. The direct App Platform hosts (`docs/geography-filter.md` names `api-dev.c211.io`) need no key for this route. Unverified for the dev deployment: whether Arcjet (`ARCJET_KEY`) is on and would rate limit or block the k6 user agent. A wave of 403 answers at the first step means that.

### Query file

`QUERIES_FILE` holds a JSON array of `{"query": "...", "weight": 1}` (plain strings also work). `queries.sample.json` holds 38 made-up queries (short keywords, sentences, crisis texts, Spanish). Queries typed by real users never go in the repo. Files named `queries-real*.json` and `*.private.json` are git-ignored here.

The queries with the highest `weight` form the popular pool (`POPULAR_TOP`, default 10). The rest is the one-off pool. One-off requests walk that pool in order, so no text repeats in one pass. After a full pass, a random number is appended to the text, so the text stays new. With `ONEOFF_NONCE=always` the number is always appended. Use that on a second run, because an embedding cache keeps the texts of the first run.

The private file with real queries is outside the repo (`WORK-LOG/HANDOFF-ASSETS/v2-search--serving/load-test/queries-real.json`, 620 deduplicated queries). Its source files hold no request counts, so every weight is 1 and the popular pool is simply the first 10. Real popularity needs counts from the Norse-API logs.

## Profiles

| Profile | Shape |
|---|---|
| `smoke` | 5 iterations, 1 VU. No brakes, canary or warm-up. |
| `ramp` | `ramping-arrival-rate`: steps `RAMP_STEPS` (`1,2,5,10,15,20` requests per second), 10 s climb (`RAMP_UP_S`) then 120 s hold (`STEP_S`) each. |
| `spike` | 30 s at `SPIKE_BASE_RPS` (1), jump to `MAX_RPS` for 60 s (`SPIKE_S`), then 60 s at base to see recovery. |
| `soak` | Constant `SOAK_RPS` (10) for `SOAK_MIN` (10) minutes. |

### Traffic mix

Shares of the request variant (one roll per request; the rest is a plain page-1 text query):

| Variable | Default | Request |
|---|---|---|
| `GEO_SHARE` | 0.15 | adds `coords=<lng>,<lat>` and `distance=10` (`GEO_DISTANCE`, `GEO_POINTS`): a different code path, not fused |
| `PAGE2_SHARE` | 0.10 | adds `page=2` |
| `CLARIFY_NEVER_SHARE` | 0.10 | adds `clarify=never` |
| `CUTOFF_SHARE` | 0 | adds `relevance_cutoff=on` (slow) |
| `POPULAR_SHARE` | 0.5 | share of requests that take a repeated (popular) query; the rest take a one-off query |

The popular share applies to every variant, so the tag groups overlap on purpose.

Every request carries a W3C `traceparent` with a random trace id and the sampled flag `01`.

## Safety stops (every profile except smoke)

- **Host guard.** The script refuses a production host unless `ALLOW_PROD=yes`. Known dev hosts: `api-dev.c211.io`, `dev-services.c211.io`, `dev*.c211.io`, `demo.c211.io`, `staging.c211.io`. Any other `*.c211.io` host counts as production. It refuses any profile except smoke against localhost unless `ALLOW_LOCAL_LOAD=yes`, because a local server reads production Elasticsearch.
- **Brake.** One VU that sees `BRAKE_STREAK` (3) slow (over `BRAKE_MS`, 8000) or failed (no connection, 5xx) requests in a row stops the test.
- **Stop at slow.** Per ramp step or spike phase, the test stops when p95 is over `P95_LIMIT_MS` (3000), the error rate is over `ERROR_RATE_LIMIT` (0.05), or `classify_failed` is over `CLASSIFY_FAILED_LIMIT` (0.2). k6 judges the samples of that level only, starting `JUDGE_AFTER_S` (30) seconds after the level starts. `STOP_AT_SLOW=0` turns this off.
- **Whole-run backstop.** The same error and `classify_failed` lines over the whole run, judged from 1 minute after the load starts.
- **Canary.** Every 15 s, one read-only GET to `CANARY_URL` (default `https://ml-broker.c211.io/health/live`, the URL used by the ServiceNet harness; unverified for this route). Three answers in a row that are slow (over 3000 ms) or not 200 stop the test. It starts 60 s before the load for a no-load baseline.
- **Warm-up.** Before the load, `setup()` sends `WARMUP_REQUESTS` (5) searches. They are not in the metrics. The run stops before any load if none returns 200 with `search.hits`.
- `BRAKE=0` and `CANARY=0` turn the brake and the canary off. Not recommended on dev.
- Ctrl-C stops the test at any time. A stopped run still writes the summary.

Known limit: a spike level lasts 60 s, so its p95 judged from second 30 rests on about 30 s of samples. A single bad sample at a low rate can trip the stop. Read the log line first.

## Run on dev

Run from the repo root. Replace the placeholders. Keep the laptop awake, on a wired network.

```
# 0. smoke (5 requests)
PROFILE=smoke BASE_URL=<dev base url> TENANT_ID=<tenant uuid> k6 run load-tests/v2-search/v2-search.js

# 1. ramp (about 13 minutes if no step is slow)
caffeinate -is env PROFILE=ramp BASE_URL=<dev base url> TENANT_ID=<tenant uuid> \
  QUERIES_FILE=/Users/Wimbazu_1/02_Dev/04_c211/WORK-LOG/HANDOFF-ASSETS/v2-search--serving/load-test/queries-real.json \
  k6 run load-tests/v2-search/v2-search.js 2>&1 | tee load-tests/v2-search/results/ramp-run.log

# 2. spike (about 2.5 minutes), after a clean ramp
PROFILE=spike MAX_RPS=20 BASE_URL=... TENANT_ID=... k6 run load-tests/v2-search/v2-search.js

# 3. soak (10 minutes)
PROFILE=soak SOAK_RPS=10 BASE_URL=... TENANT_ID=... k6 run load-tests/v2-search/v2-search.js
```

## Before the run

- [ ] Tell the owners of `ml-broker` and of Elasticsearch, with the date, the profile and the maximum rate.
- [ ] Remember that dev and prod share one `ml-broker` instance. A dev load test loads prod classification.
- [ ] Check that the dev deployment has `V2_SEARCH_ENABLED=true`. Without it every request is 404 and the warm-up stops the run.
- [ ] Check `V2_CLASSIFY_TIMEOUT_MS` and `ML_BROKER_EMERGENCY_ONLY_SUPPORTED` on the target. Record them with the results.
- [ ] Run the smoke profile against the target first.
- [ ] Open the `ml-broker` and Elasticsearch dashboards and Tempo before the first step.
- [ ] Pick a tenant whose search is allowed to run at this volume.

## Read the results

The text summary is printed and written next to a JSON file in `load-tests/v2-search/results/` (git-ignored). The JSON holds all k6 metrics.

- Group table: count, p50, p95, p99, error rate and `classify_failed` rate for popular, one-off, plain, geo, page2, `clarify=never` and `cutoff=on`. Compare popular with one-off: the gap is what an embedding cache can win.
- Level table (ramp and spike): the same numbers per step. `OVER A LINE` marks the first level that crossed a limit.
- `classify_failed` above 0 means `ml-broker` timed out or failed at that rate. It rises before errors do. Results with no `model_version` have no need guess.
- `clarification present` counts answers with a clarification block. With `clarify=never` only the emergency question remains.
- `dropped_iterations` above 0 means the generator could not keep the rate (VU cap `MAX_VUS`, 300, or a slow laptop). Then the numbers measure the laptop too.
- A failed run reason is a log line starting `BRAKE` or `CANARY BRAKE`, or k6's `thresholds ... were crossed`.

## Find a request in Tempo

Slow (over 2 s, `SLOW_LOG_MS`) and failed requests print a line like `SLOW trace_id=<32 hex> status=200 ms=2409 qgroup=oneoff variant=plain level=5`. The script never logs the query text.

- Trace id: open Tempo, search by trace id, paste the 32 hex characters.
- All v2 searches: TraceQL `{ name = "v2.search" }`. Narrow with `{ name = "v2.search" && duration > 2s }`.

Norse-API keeps the caller's sampling decision from `traceparent` (`docs/observability.md`), and the script sends the sampled flag, so every request has a trace. The span name `v2.search` is taken from the request brief and is not verified against the code in this branch.
