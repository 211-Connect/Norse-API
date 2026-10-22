# Printable Directories (Tenant API)

## Scope

Printable Directories provides tenant-scoped, user-authenticated APIs to assemble printable collections of resources.

- Auth: Keycloak (`KeycloakGuard`)
- Tenant isolation: `x-tenant-id` middleware scope
- Versioning: API version `1` using `x-api-version`
- Data source model: section sources can resolve from search query payloads, favorites lists, or explicit resource IDs
- Preview strategy: resource payloads are resolved live at preview time (no persisted snapshots)

## Core Concepts

- Directory owner: `ownerUserId`
- Access policy:
  - `private`
  - `shared-read`
  - `shared-edit`
- Audit field: `updatedBy`
- Localized text fields use `{ values: { [locale]: string }, autoTranslatedLocales: string[] }`
  - `values`: map of locale to text
  - `autoTranslatedLocales`: locales whose value was machine-translated and is safe to overwrite with an automatic re-translation; locales with values but not in this list are treated as human-edited and protected
  - cover: `titleLocalized`, `descriptionLocalized`
  - section: `headingLocalized`, `descriptionLocalized`
  - header/footer: `textLocalized`
- Header/footer layout is an ordered array of tokens: `text | logo | domain | date`
- Logo: one directory-level `logoUrl`, printed wherever the header or footer layout includes `logo` (null: the tenant's logo). Set on create/update; an empty string clears it.
- Directory-level query defaults: `defaultQueryConfig` with optional `locationName`, `coords` (`{ latitude, longitude }` object), and `radius`
- Primary language: `primaryLanguage` (locale code, e.g. `en`, `es`). Required at creation, immutable after creation, and always included in `locales`.
- Locale configuration:
  - `locales` (array of locale codes): the languages the directory is offered in (translated, printed and shared in), set on create/update and stored; `primaryLanguage` is always included and it defaults to `[primaryLanguage]`. Directories created before `locales` was stored have none, and get it derived from content instead (every locale with a non-empty value for any localized field).
  - `defaultLocale` (string, default `en`): fallback locale used when the requested/resolved locale has no localized value; replaces the previously hardcoded `en` fallback in localized-text resolution and preview locale resolution
- Public sharing: `slug` (optional string, unique per tenant)
  - Never auto-generated; must be explicitly supplied by the client on create/update
  - Acts as a capability token for `GET /printable-directories/public/:slug/preview` (see below): resolution ignores `accessPolicy` entirely, including `private`
  - Enforced unique per tenant via a MongoDB partial unique index; duplicate slugs return `409 Conflict`

## Endpoints

Base path: `/printable-directories`

- `GET /`
  - paginated list for tenant scope
  - includes owned + shared-readable directories
- `POST /`
  - create directory (`name` and `primaryLanguage` required)
  - optional `accessPolicy`, `slug`, `defaultQueryConfig`
- `GET /:id`
  - returns one directory if readable under policy
- `PATCH /:id`
  - update metadata and layout settings if editable under policy
  - `primaryLanguage` is immutable after creation
- `DELETE /:id`
  - owner delete

Sections:

- `POST /:id/sections`
- `PATCH /:id/sections/:sectionId`
- `DELETE /:id/sections/:sectionId`
- `PATCH /:id/sections/reorder`

Sources:

- `POST /:id/sections/:sectionId/sources`
- `PATCH /:id/sections/:sectionId/sources/:sourceId`
- `DELETE /:id/sections/:sectionId/sources/:sourceId`
- `PATCH /:id/sections/:sectionId/sources/reorder`

Preview:

- `GET /:id/preview?locale=<locale>`
  - resolves all sources in order
  - de-duplicates resources by ID within section
  - enforces `maxResources`
  - localized fallback behavior: requested locale -> directory `defaultLocale` (default `en`) -> empty string
  - missing resources are omitted from the resolved section; warnings are logged for resolution errors

## Public Sharing (Preview by Slug)

A separate, fully public/unauthenticated controller exposes preview-by-slug
for sharing a printable directory PDF via URL:

- `PrintableDirectoryPublicController` (no `KeycloakGuard`), registered
  independently from the authenticated `PrintableDirectoryController` so no
  auth-bypass logic lives on the guarded routes
- `GET /printable-directories/public/:slug/preview?locale=<locale>`
  - no bearer token required; `x-tenant-id` is still required (tenant/locale
    middleware still applies)
  - resolves the directory by `tenantId` + `slug` only — ignores
    `accessPolicy` and owner checks entirely, including `private` directories
  - `favorites_list` sources resolve against the directory owner's favorites
    list (`ownerUserId`), since there is no requesting user identity in this
    flow
  - same resolution semantics as `GET /:id/preview` otherwise (dedupe,
    `maxResources`, localized fallback)
  - clients should choose non-guessable slugs for directories that should not
    be publicly discoverable

## Scheduled PDF Deliveries

Recurring emails of a directory's PDF, sent by Norse's daily job (see Norse's
`docs/scheduled-pdf-delivery.md`). Stored in `printableDirectoryDeliveries`,
one document per schedule, deleted together with their directory.

- `frequency`: `weekly` (`weekdays`, 0 = Sunday … 6) or `monthly`
  (`monthDays`, 1–28).
- `print`: `locale` (one of the directory's languages), `variant`,
  `fontSize`, `booklet`.
- `recipients`: 1–100 emails, trimmed, lowercased, deduplicated.
- `createdByEmail`: taken from the token's `email` claim, never the body.
- Limits: 100 deliveries per directory (`409` beyond that).

User endpoints (Keycloak, directory edit access: owner or `shared-edit`):

- `GET|POST /printable-directories/:id/deliveries`
- `PATCH|DELETE /printable-directories/:id/deliveries/:deliveryId`

The tenant-level `scheduledPdfDelivery` capability is enforced by Norse
(ADR 0001), not here.

Internal endpoints (`x-internal-api-key` + `x-tenant-id`), for the job:

- `GET /internal/printable-directory-deliveries/due?date=YYYY-MM-DD` —
  enabled deliveries whose weekday or month day matches the calendar date and
  that are not yet claimed for it, each with a directory summary.
- `POST /internal/printable-directory-deliveries/:deliveryId/claim` —
  atomic; `{ claimed: false }` when already claimed for that date, so a
  delivery is sent at most once a day.
- `POST /internal/printable-directory-deliveries/:deliveryId/result` —
  records `lastRun` (`sent | sent_as_link | failed | skipped`).
- `GET /internal/printable-directory-deliveries/:deliveryId/preview` — the
  directory preview resolved as its owner, in the delivery's locale by
  default.

## Source Types

Each section source has `type` and one matching payload:

- `query`
  - requires `query` object with serialized `/search` params (+ optional body)
  - preview fallback: if `params.coords` or `params.distance` is missing, service uses directory `defaultQueryConfig.coords` / `defaultQueryConfig.radius`
  - precedence: source `query.params` values always override directory defaults
- `favorites_list`
  - requires `favoritesListId`
- `resource_ids`
  - requires non-empty `resourceIds`

## Shared Resource OpenAPI Schema

To avoid schema drift across modules, API docs reuse one shared resource OpenAPI DTO:

- DTO: `src/resource/dto/transformed-resource.openapi.dto.ts`
- Used by:
  - Resource endpoints (`GET /resource/:id`, `GET /resource/original/:id`)
  - Printable preview section resources

Swagger examples reuse `RESOURCE_EXAMPLE` for consistency.
