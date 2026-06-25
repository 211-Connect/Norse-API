# AI Search — Comprehensive Documentation (Norse API)

This file is the single source of truth for AI search behavior, product flow, API contracts, validation choices, and implementation details.

## Purpose and scope

Norse API is a compact proxy between Norse Frontend and ML Broker for AI classification and re-ranking. It:

- accepts frontend AI search requests,
- forwards them to ML Broker with server-owned credentials,
- returns frontend-ready fields,
- does not execute OpenSearch resource search,
- return data which can be used for subsequent requests.

Frontend always executes hybrid search.

## System components

- Norse Frontend — Next.js UX and hybrid-search routing.
- Norse API — NestJS proxy/API orchestration.
- ML Broker — predict/re-rank inference service.
- OpenSearch — downstream resource search (called by frontend search flow, not by these AI endpoints).

## Public endpoints

- `POST /search/predict`
- `POST /search/re-rank`

Required headers:

- `x-api-version: 1`
- `x-tenant-id`
- `accept-language`
- `Content-Type: application/json`

## Configuration and constants

Required env vars:

- `ML_BROKER_BASE_URL`
- `ML_BROKER_API_KEY`

Runtime constants:

- `top_k = 150` for predict and re-rank.
- `pre_selected = score > 0.6`.
- ML Broker timeout: 10s.

## ML Broker integration

Norse calls:

- `POST {ML_BROKER_BASE_URL}/api/v1/tasks/needs-classification/predict`
- `POST {ML_BROKER_BASE_URL}/api/v1/tasks/needs-classification/re-rank`

Norse sends broker auth server-side:

- `x-api-key: ML_BROKER_API_KEY`

Norse never forwards inbound user auth headers to ML Broker.

## High-level product flow

1. User enters query.
2. Frontend calls `/search/predict` (feature-flag gated).
3. Norse calls ML Broker `/predict`.
4. Norse returns compact payload: `scenario`, `options`, `hsis_taxonomies`.
5. Frontend behavior (scenarios):
   - `search`: navigate hybrid results immediately.

- `search_and_notify_low_info`: navigate hybrid results and display an alert for low-info query
- `search_and_notify_low_confidence`: navigate hybrid results and display an alert for low-confidence classification
- `clarify_low_info`: show multi-select; user can skip/confirm.
- `clarify_multiple_labels`: show multi-select; user can skip/confirm.

6. If user confirms clarify selection, frontend calls `/search/re-rank` with `need_weights`.
7. Norse forwards `need_weights` directly to ML Broker `/re-rank` and returns `hsis_taxonomies`.
8. Frontend navigates hybrid results with original query + deduplicated taxonomy hints.

## Predict API

### Request

```json
{
  "query": "childrens hospital"
}
```

Rules:

- `query` required, string, min length 1.
- `tenant_id` comes from `x-tenant-id` header (not body).

Norse forwards to ML Broker:

```json
{
  "query": "childrens hospital",
  "tenant_id": "<x-tenant-id>",
  "top_k": 100
}
```

### Response

```json
{
  "scenario": "search",
  "options": [
    {
      "code": "BH-1800",
      "score": 0.91,
      "pre_selected": true,
      "results_count": 127
    }
  ],
  "hsis_taxonomies": ["BH"]
}
```

Clarify example:

```json
{
  "scenario": "clarify_multiple_labels",
  "options": [
    {
      "code": "BH-1800",
      "score": 0.71,
      "pre_selected": true,
      "results_count": 386
    },
    {
      "code": "BV-8900",
      "score": 0.69,
      "pre_selected": true,
      "results_count": 209
    }
  ],
  "hsis_taxonomies": ["BH", "BV"]
}
```

### Predict response fields

- `scenario`: `search` | `clarify_low_info` | `clarify_multiple_labels` | `search_and_notify_low_info` | `search_and_notify_low_confidence`.
- `options`: list derived from broker needs.
- `options[].code`: need code (frontend translation key input).
- `options[].score`: broker confidence score.
- `options[].pre_selected`: `score > 0.6`.
- `options[].results_count`: number how many resources are assigned to this option.
- `hsis_taxonomies`: taxonomy hints for hybrid search request.

Predict excludes broker verbose internals not needed for frontend orchestration.

### Scenario mapping

Order:

1. evaluate `low_info.is_low_info`,
2. then `confidence` fields.

Decision:

- Low info + multiple top labels -> `clarify_low_info`
- Low info + 0/1 top label -> `search_and_notify_low_info`
- High confidence + multiple high-confidence labels -> `clarify_multiple_labels`
- High confidence + single dominant label -> `search`
- Low confidence -> `search_and_notify_low_confidence`

## Re-rank API

### Request

```json
{
  "need_weights": {
    "HO-300": 0.907,
    "IC-330": 0.0817
  }
}
```

Rules:

- `need_weights` is required.
- values are required numeric scores.
- property name is exactly `need_weights` (snake_case) in both Norse API and ML Broker.
- Norse forwards `need_weights` directly to ML Broker (no transform function).

Norse forwards to ML Broker:

```json
{
  "tenant_id": "<x-tenant-id>",
  "need_weights": {
    "HO-300": 0.907,
    "IC-330": 0.0817
  },
  "top_k": 100
}
```

### Response

```json
{
  "hsis_taxonomies": ["BH-3800", "BT-4500.4500-050"]
}
```

## Frontend behavior contract

Frontend always uses `query_type=hybrid`.

For `search`, `search_and_notify_low_info`, `search_and_notify_low_confidence`, and clarify skip:

- use original query + deduplicated predict `hsis_taxonomies`.

For clarify confirm:

- send selected weights to `/search/re-rank` as `need_weights`,
- use returned deduplicated `hsis_taxonomies` + original query.

Translation rules:

- frontend maps option `code` to i18n keys (`needs.<CODE>.name`, `needs.<CODE>.description`).

## Error handling

If ML Broker is unavailable:

- timeout -> `503 Service Unavailable`,
- non-2xx broker response -> `502 Bad Gateway`,
- request failure -> `502 Bad Gateway`.

Frontend should fallback to classic search UX when AI calls fail.

## Security

- Never expose `ML_BROKER_API_KEY` to frontend.
- Never accept `tenant_id` from request body.
- Never forward inbound user auth headers to broker.

## Manual smoke test

```bash
curl -X POST 'http://localhost:8080/search/predict' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: default' \
  -H 'accept-language: en' \
  -H 'Content-Type: application/json' \
  -d '{"query":"childrens hospital"}'

curl -X POST 'http://localhost:8080/search/re-rank' \
  -H 'x-api-version: 1' \
  -H 'x-tenant-id: default' \
  -H 'accept-language: en' \
  -H 'Content-Type: application/json' \
  -d '{"need_weights":{"HO-300":0.907}}'
```
