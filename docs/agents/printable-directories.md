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
- Localized text fields use `{ values: { [locale]: string } }`
  - cover: `titleLocalized`, `descriptionLocalized`
  - section: `headingLocalized`, `descriptionLocalized`
  - header/footer: `textLocalized`
- Header/footer layout is an ordered array of tokens: `text | logo | domain | date`
- Directory-level query defaults: `defaultQueryConfig` with optional `locationName`, `coords` (`{ latitude, longitude }` object), and `radius`
- Booklet layout: `isBookletLayout` (boolean, default `false`)
  - When `true`, the printable document must be generated with a total page
    count that is a multiple of four
  - Blank pages are inserted after the cover (page 2) and/or before the back
    cover (page n-1) as needed, so the cover stays the first page and the back
    cover stays the last page
  - Page generation/insertion happens client-side when rendering the preview
    into a printable document; the API only stores and returns the flag
  - Existing directories without the field stored in MongoDB default to `false`

## Endpoints

Base path: `/printable-directories`

- `GET /`
  - paginated list for tenant scope
  - includes owned + shared-readable directories
- `POST /`
  - create directory (name required)
  - optional `accessPolicy`, `resourceLayout`
- `GET /:id`
  - returns one directory if readable under policy
- `PATCH /:id`
  - update metadata and layout settings if editable under policy
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
  - localized fallback behavior: requested locale -> `en` -> empty string
  - fails whole preview when any source/resource resolution fails

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
