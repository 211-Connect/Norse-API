# Tenant app config

`GET /tenant-config/:tenantId/app-config?locale=en` returns a tenant's theme
colors, map center and zoom, default search radius and active alerts. The
Connect211 mobile app reads it through the API gateway
(`services.c211.io/norse-api/v1`) with its tenant key, so the app needs no
Payload URL or Payload key of its own.

## Where the data comes from

Unlike the other `tenant-config` routes, this one does not read CMS Redis DB 2.
Payload does not publish these fields there. They live in the AppConfig that
Payload builds for the Norse website, and `TenantAppConfigService` reads it from
Payload's `GET /api/tenants/:id/config` with `PAYLOAD_APP_CONFIG_API_KEY` as a
bearer token. It passes on only the four groups above, in Payload's nesting
(`brand.theme`, `search.map`, `search.defaultRadius`, `alerts`), and drops any
malformed field.

`search.map.center` is always `[longitude, latitude]`, the order Mapbox,
MapLibre and the mobile app read. Payload does not guarantee it: its fallback
for a directory with no center (`buildAppConfig` in Norse) is latitude first,
`[39.8283459, -98.5794797]`. `toLngLat` swaps a pair whose second value is
outside ±90, since that cannot be a latitude, and passes on a pair with both
values within ±90 unchanged, since its order cannot be told. Fixing the
fallback in Norse would also fix the Norse website's map for those
directories; this swap stays correct either way.

## Caching and load on Payload

The caching mirrors how the Norse website reads the same AppConfig:

| Layer             | Norse website                              | Norse-API                                               |
| ----------------- | ------------------------------------------ | ------------------------------------------------------- |
| In-process        | 1-minute LRU                               | 1-minute LRU per tenant and locale (`LRU_CACHE_CONFIG`) |
| Shared            | Redis `app_config:<host>:<locale>`, 1 hour | none: Payload answers from that same Redis entry        |
| Concurrent misses | single-flight per key                      | one Payload call per key at a time                      |

Payload therefore sees at most about one request per tenant, locale and pod
per minute, however many clients there are. It answers each one from its
cached AppConfig, which the tenant and resource-directory save hooks
(`revalidateCache`) delete. An edit in Payload reaches clients within about
two minutes: one for the one-minute memory cache on the Payload instances that
did not handle the save, and one for Norse-API's. Payload's route also sends
`Cache-Control: public, s-maxage=60, stale-while-revalidate=59`, so a CDN in
front of `PAYLOAD_URL` can add up to two minutes more.

Norse-API deliberately has no Redis layer of its own here. Payload's save
hooks could not clear it, so it would only add staleness.

Failures are never cached. `POST /cms-config/cache/clear[/:tenantId]` also
clears this cache on the pod that receives it.

## Errors

| Payload                                             | Norse-API         |
| --------------------------------------------------- | ----------------- |
| timeout (5 s)                                       | `503`             |
| network error, non-2xx other than 400/404, non-JSON | `502`             |
| `404` (unknown tenant, or no trusted domain)        | `404`             |
| `400` (locale)                                      | `400`             |
| `PAYLOAD_URL` / `PAYLOAD_APP_CONFIG_API_KEY` unset  | `500`, no request |

## Tenant scope

The gateway's `TenantScopeGuard` checks the key against `x-tenant-id`, not the
path. So the route requires `:tenantId` to be a UUID equal to `x-tenant-id`
(`400 tenant_target_mismatch` otherwise). Without that check, any key could make
Norse-API call Payload for arbitrary tenant ids, bypassing the cache.

## Configuration

| Variable                     | Value                                           |
| ---------------------------- | ----------------------------------------------- |
| `PAYLOAD_URL`                | `https://payload-administration.c211.io` (prod) |
| `PAYLOAD_APP_CONFIG_API_KEY` | Payload's `PAYLOAD_APP_CONFIG_API_KEY`          |
