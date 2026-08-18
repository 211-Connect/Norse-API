# Taxonomy Scorecard Customization (Internal API)

## Scope

This feature adds internal API endpoints in Norse API to support PayloadCMS customization UI for ML taxonomy scorecards stored in MongoDB collection `taxonomy_scorecard`.

- Auth: `x-internal-api-key` (`InternalApiGuard`)
- Versioning: API version `1` using `x-api-version`
- Elasticsearch taxonomy search index: `hybrid_taxonomies` (hardcoded)
- MongoDB lookup key for taxonomy scorecards: `_id = <hsisCode>::<owner>` (for example `BD::default`, `BD::tenant-1`)
- Tenant behavior:
  - Read config: use tenant override when present; otherwise fallback to default owner
  - Update config: supports publish and draft save modes
  - Enable: activate a saved version without creating a duplicate history entry

## Endpoints

### 1) Search taxonomies for UI picker

`GET /taxonomy-scorecard/taxonomies?tenant_id=<id>&query=<q>&page=1&limit=10`

- Data source: Elasticsearch `hybrid_taxonomies`
- Filter: `tenant_id = <id>`
- Search:
  - case-insensitive prefix over `code`
  - prefix-style match over taxonomy `name`
- Sort: by `code` ascending
- Output: paginated `[{ code, name }]`
- Validation: blank `query` (after trim) returns `400`
- Validation: `limit` max is `100`

### 2) Get effective tenant config for taxonomy code

`GET /taxonomy-scorecard/tenants/:tenantId/taxonomies/:hsisCode`

- Read order:
  1. tenant override document by `_id = <hsisCode>::<tenantId>`
  2. default document by `_id = <hsisCode>::default`
- Response includes:
  - MongoDB scorecard document shape
  - If tenant override exists, returns tenant document
  - Otherwise returns default document

### 3) Update taxonomy config (single or bulk with children)

`PUT /taxonomy-scorecard/tenants/:tenantId/taxonomies/:hsisCode`

Query params:

- `draft?: boolean` (default `false`)

Body:

- `weights: Record<string, number>` (required)
- `include_children?: boolean`
- `include_siblings?: boolean`

Behavior:

- Always writes tenant-owned versions.
- If tenant document does not exist, clone effective document into a tenant document first.
- Save mode (`draft=false`):
  - saves submitted scorecard as new version
  - updates current scorecard to submitted scorecard
  - sets `version_metadata.active_version` to new version id
- Draft mode (`draft=true`):
  - saves submitted scorecard as new version
  - keeps current scorecard unchanged
  - keeps `version_metadata.active_version` unchanged
- Version IDs are numeric string keys (`"0"`, `"1"`, ...).
- For legacy docs without `versions`, first saved snapshot uses version `0`.
- On first customization from default (no prior active version), system saves:
  - current default scorecard as historical version
  - submitted scorecard as new version
  - and sets `active_version` to the new submitted version
- If `include_children=true`, apply same submitted weights to structural descendants based on hierarchy levels.
- If `include_siblings=true`, apply same submitted weights to direct siblings sharing the same structural parent and level.
- If both flags are true, apply to self + siblings + descendants of self and siblings.

Response:

- `affected_codes`: taxonomies actively updated now (empty for draft)
- `potentially_affected_codes`: taxonomies that draft version was saved for (present for draft)
- `new_version_count`: number of saved versions (one per targeted taxonomy)

### 4) Enable taxonomy config version

`POST /taxonomy-scorecard/tenants/:tenantId/taxonomies/:hsisCode/enable`

Body:

- `version_id: number` (required)

Behavior:

- Enables `scorecard` from requested version entry.
- Updates source metadata (`published_at`).
- Sets `version_metadata.last_action = enable` and `active_version = version_id`.
- Does **not** append another snapshot to versions.

## Versioning Schema

Stored in each tenant scorecard doc:

- `versions: { [versionId: string]: { scorecard, source, created_at } }`
- `version_metadata`:
  - `next_version: number`
  - `active_version: number | null`
  - `last_action: "update" | "enable"`

Response shape note:

- each returned `versions[versionId]` entry includes `version_id` equal to the object key

Rules:

- On update: save submitted scorecard as a new version, then increment `next_version`.
- On update with `draft=false`: set `active_version` to the new submitted version.
- On update with `draft=true`: keep `active_version` unchanged.
- On enable: restore from `versions[version_id]`, keep `next_version` unchanged except normalization fallback, do not write new snapshot.

## Hierarchy Model

Taxonomy hierarchy is structural and supports mixed letter, hyphen, and dot levels:

- Level I: `L`
- Level II: `LR`
- Level III: `LR-8000`
- Level IV: `LR-8000.0500`
- Level V: `LR-8000.0500-800`
- Level VI: `LR-8000.0500-800.05`

Parent chain example:

- parent(`LR`) = `L`
- parent(`LR-8000`) = `LR`
- parent(`LR-8000.0500`) = `LR-8000`
- parent(`LR-8000.0500-800`) = `LR-8000.0500`
- parent(`LR-8000.0500-800.05`) = `LR-8000.0500-800`

## Children and Siblings Behavior

Selected code: `LR-8000.0500`

- `include_children=false`, `include_siblings=false`
  - updates: `LR-8000.0500`
- `include_children=true`, `include_siblings=false`
  - updates: `LR-8000.0500`, `LR-8000.0500-800`, `LR-8000.0500-800.05`
- `include_children=false`, `include_siblings=true`
  - updates: `LR-8000.0500`, `LR-8000.0600`
  - does not include `LR-8000.0500-800` (child) or `LR-9000.0500` (different parent)
- `include_children=true`, `include_siblings=true`
  - updates selected + direct siblings + descendants of selected and descendants of siblings

## Notes

- Index creation remains compatible with `customization.md` recommendations.
- This API is intentionally internal and PayloadCMS-facing only.
- ML Broker can continue reading effective tenant/default docs from MongoDB directly.
