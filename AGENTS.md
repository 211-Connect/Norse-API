# AGENTS.md — Norse API

Agent-facing reference for working in this repo.

## What this service is

Norse API is a NestJS backend in the [211-Connect](https://github.com/211-Connect) ecosystem.
It sits between the **Norse** frontend (`https://github.com/211-Connect/Norse`, Next.js) and
downstream services (Elasticsearch, MongoDB, ML Broker, Mapbox, Opencage, Umami). It:

- serves resource/taxonomy/organization search backed by Elasticsearch,
- proxies AI search classification/re-ranking to an ML Broker (see
  [docs/ai-search-classification.md](docs/ai-search-classification.md)),
- stores favorites, favorite lists, printable directories, taxonomy scorecards in MongoDB,
- **is the source of truth for the OpenAPI spec that generates the Norse frontend's API SDK.**

## ⚠️ OpenAPI is a contract — read this before touching any controller/DTO

The Norse frontend runs `npm run generate:api-sdk` against this service's
`/swagger/json` document to generate its typed API client (`src/lib/api/generated/*`
in the frontend repo). This means:

- **Every** public endpoint needs accurate `@ApiTags`, `@ApiResponse`, `@ApiBody`,
  `@ApiQuery`/`@ApiHeader` decorators, and every DTO needs `@ApiProperty` on all fields
  (including `required`, `enum`, `default`, nested types).
- Changing a field name, type, optionality, or response shape is a **breaking change**
  for the generated frontend SDK, not just an internal refactor. Treat it like a public API change.
- Prefer additive changes (new optional fields, new endpoints) over renames/removals.
  If a rename/removal is unavoidable, call it out explicitly as a breaking change.
- New request/response types must be `class-validator`/`class-transformer` DTO classes
  with Swagger decorators — do not model them as bare interfaces/types or new Zod schemas
  (Zod remains only in the places it's already used: header parsing, see
  [src/common/dto/headers.dto.ts](src/common/dto/headers.dto.ts)).
- After changing controllers/DTOs, sanity-check the generated document is still sensible:
  run the app and hit `GET /swagger/json`, or open `/swagger`.
- If you don't have access to the Norse frontend repo in this workspace, still write
  decorators as if a consumer's SDK generator is reading them literally — don't skip
  `@ApiProperty`/`@ApiResponse` because "it still works at runtime".

## Request lifecycle (order matters)

1. `ServiceProviderMiddleware` (all routes) — attaches `req.cacheService`, `req.configService`.
2. `TenantMiddleware` (only controllers registered in [src/app.module.ts](src/app.module.ts)) —
   validates `x-tenant-id` (must be a UUID) and, if present, that `?tenant_id=` matches it.
   Throws `400` otherwise. **Every tenant-scoped request must carry `x-tenant-id`.**
3. `LocaleMiddleware` (subset of controllers) — parses `accept-language` into `req.locale`.
4. Guards, in whatever order a controller applies them, e.g.:
   - `KeycloakGuard` ([src/auth/guards](src/auth/guards)) — user auth, populates `@User()`.
   - `ArcjetGuard` ([src/common/guards/arcjet.guard.ts](src/common/guards/arcjet.guard.ts)) — bot/abuse protection via Arcjet; never blocks (`isDenied()` is logged, not enforced) — check before assuming it blocks traffic.
   - `InternalApiGuard` — requires `x-internal-api-key` for internal-only routes.
   - `CustomThrottlerGuard` ([src/common/guards/throttler.guard.ts](src/common/guards/throttler.guard.ts)) — Redis-backed rate limiting; bypassed when `x-api-key` equals `INTERNAL_API_KEY`.
5. Global `ValidationPipe` (class-validator) runs with `whitelist: false` /
   `forbidNonWhitelisted: false` for now — see migration note below.
6. Global `HttpExceptionFilter` shapes all error responses with tenant/request metadata.

## Validation: class-validator vs Zod

- **New code**: use `class-validator` + `class-transformer` DTO classes with
  `@ApiProperty` decorators (see [src/search/dto/ai-search-predict-query.dto.ts](src/search/dto/ai-search-predict-query.dto.ts)
  for the pattern: `@IsString`, `@IsOptional`, `@Type(() => Number)`, etc.).
- **Do not** add new Zod schemas. Zod is legacy, kept only for header parsing
  ([src/common/dto/headers.dto.ts](src/common/dto/headers.dto.ts), applied via
  `ZodValidationPipe`) until the migration finishes.
- The global `ValidationPipe` currently has `whitelist: false`. Don't rely on it stripping
  unknown properties — it will be flipped to `true` once Zod is fully removed; write DTOs
  as if whitelisting were already on (declare every field you expect).

## Module map (`src/`)

| Module                       | Purpose                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search/`                    | Resource search (`SearchService`/`HybridSearchService`) + AI classification/re-rank proxy (`AiSearchService`) to ML Broker. See [docs/ai-search-classification.md](docs/ai-search-classification.md). |
| `resource/`                  | Single-resource lookups against Elasticsearch.                                                                                                                                                        |
| `taxonomy/`                  | HSIS taxonomy tree lookups.                                                                                                                                                                           |
| `taxonomy-scorecard/`        | Taxonomy scorecard customization; see [docs/taxonomy-scorecard-customization.md](docs/taxonomy-scorecard-customization.md).                                                                           |
| `favorite/` `favorite-list/` | User favorites, backed by MongoDB, gated by `KeycloakGuard`.                                                                                                                                          |
| `organization/`              | Organization lookups.                                                                                                                                                                                 |
| `printable-directory/`       | Printable directory generation; public + authenticated controllers — see [docs/printable-directories.md](docs/printable-directories.md).                                                              |
| `geocoding/`                 | Mapbox/Opencage geocoding wrappers.                                                                                                                                                                   |
| `suggestion/`                | Search/autocomplete suggestions.                                                                                                                                                                      |
| `short-url/`                 | URL shortening/redirects.                                                                                                                                                                             |
| `analytics/`                 | Umami-backed analytics endpoints, with an internal-only surface (`analytics/internal`) and an LRU + Redis two-tier cache (`ANALYTICS_*` env vars).                                                    |
| `cms-config/`                | Tenant/orchestration config sourced from a CMS, cached via `cms-redis.service.ts`.                                                                                                                    |
| `auth/`                      | Keycloak-based auth guard/services.                                                                                                                                                                   |
| `health/`                    | Health check endpoint.                                                                                                                                                                                |
| `metrics/`                   | Prometheus metrics, pushed to a Pushgateway.                                                                                                                                                          |
| `common/`                    | Cross-cutting: config, guards, middleware, filters, decorators, Mongoose schemas, request-scoped cache service.                                                                                       |

## Tenancy & security rules

- Tenant id always comes from the `x-tenant-id` header, never from the request body —
  the ML Broker/AI search docs call this out explicitly, and it generalizes to every module.
- Never forward inbound end-user auth headers to downstream services (ML Broker, etc.);
  downstream auth is service-owned (e.g. `x-api-key` set server-side from `ML_BROKER_API_KEY`).
- Internal-only routes should use `InternalApiGuard` (`x-internal-api-key`) and/or live under
  an `internal/` submodule (see `analytics/internal`).
- Don't log secrets (`ML_BROKER_API_KEY`, `INTERNAL_API_KEY`, Keycloak tokens, etc.).
- Downstream failures: broker/service timeout → `503`; non-2xx/failed request → `502`
  (established pattern in the AI search module — reuse it for new proxied integrations).

## Testing conventions

- Jest, colocated `*.spec.ts` next to the file under test, `rootDir: src` (see
  [package.json](package.json)).
- Unit tests use `Test.createTestingModule` with hand-rolled `jest.fn()` mocks for
  providers (Mongoose models via `getModelToken`, external clients, etc.) — see
  [src/favorite/favorite.service.spec.ts](src/favorite/favorite.service.spec.ts).
  Don't reach for a mocking library; follow this existing pattern.
- Run `npm run test` for unit tests, `npm run test:e2e` for e2e
  ([test/app.e2e-spec.ts](test/app.e2e-spec.ts)), `npm run test:cov` for coverage.
- Add/update a `*.spec.ts` alongside any service/controller you touch or add.

## Build & run

- `npm install`, `npm run build`, `npm run start:dev` (watch mode), `npm run lint`.
- Swagger UI at `/swagger`, raw OpenAPI JSON at `/swagger/json` (this is what the
  frontend SDK generator consumes — see the OpenAPI section above).
- Env vars are documented in [.env.template](.env.template) and mapped in
  [src/common/config/configuration.ts](src/common/config/configuration.ts) — add new
  vars to **both** when introducing config.

## Bootstrap & integrations

- [src/main.ts](src/main.ts) sets up the global `HttpExceptionFilter`, the global
  `ValidationPipe` (see whitelist note above), Helmet, CORS, and header-based API
  versioning (`x-api-version` via `VersioningType.HEADER`).
- [src/app.module.ts](src/app.module.ts) wires infra providers and registers domain
  modules: Redis cache (`cache-manager-redis-store`), a Redis-backed rate limiter, and
  the MongoDB connection (Mongoose).
- External integrations used by services: Elasticsearch (search/resource/taxonomy),
  Mapbox/Opencage SDKs (geocoding), the ML Broker (AI search), and Umami (analytics).

## Skills

Domain skills live under `.agents/skills/` (MongoDB schema/query/search, Elasticsearch
ES|QL, NestJS best practices) and are tracked in [skills-lock.json](skills-lock.json).
Use them for relevant tasks (e.g. Mongoose schema changes, ES|QL analytics queries,
NestJS architecture questions) but always reconcile their suggestions with the
conventions in this file — repo conventions win over generic skill advice. Review any
skill-generated code for correctness and security before accepting it.
