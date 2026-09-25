# Internal services search and facets

ServiceNet's record selector lists and facets services through two internal
routes over the shared Elasticsearch `services` index. The index is loaded by
Dagster `configurable-readers` (Dagster PR #601, ISS-1867). See
architecture-docs ADR 0022 and INTEG-022.

| Route | Body | Returns |
| --- | --- | --- |
| `POST /internal/services/search` | `resourceWriterIds` (required), `filter.taxonomyCodes`, `filter.statuses`, `text`, `offset` (default 0), `limit` (default 50, max 200) | `{ items, total, offset, limit }` |
| `POST /internal/services/facets` | `resourceWriterIds` (required) | `{ contributors, statuses, taxonomy }` |

Send `x-api-version: 1`, as for every versioned route. No `x-tenant-id`: the
writer set is the scope, as it was in the Mongo query, and one writer's records
can sit under several tenants.

## Status

- **Unpublished.** `@ApiExcludeController()` keeps both routes out of
  `/swagger/json`, so the Norse SDK never sees them.
  `service-search.controller.spec.ts` checks the generated document.
- **Unauthenticated.** They trust the writer set they are given. Auth is
  ISS-1876. Until then they must not be reachable through the gateway.

## Semantics

These mirror ServiceNet's Mongo record source
(`packages/internal/sharing-mongo/src/record-source.ts`: `buildQuery`,
`listRecords`, `listFilterOptions`). `service-search.parity.spec.ts` runs both
over one fixture and compares the results.

- **Writer set.** The writer ids are matched with `terms`, which is `$in`. An
  empty set returns nothing and ES is not called.
- **Canonical only.** The query is `must_not isCanonicalPublication: false`,
  which is `$ne: false`. A document without the flag counts as canonical.
- **Usable `serviceId`.** The field must exist and must not be `""`.
- **Taxonomy.** Codes are matched exactly against the ancestor-expanded
  `taxonomyPath`, never by prefix: `BD-18` is a sibling of `BD-1800`, not its
  parent.
- **Order.** Results are sorted by `name.raw` ascending with a missing name
  first, then by `serviceId`. `name.raw` is a case-sensitive keyword, so this
  is Mongo's binary order. Results are never sorted by score, so pages stay
  stable when text is added.
- **Total.** `track_total_hits: true` makes `total` count every match instead
  of stopping at 10,000.
- **Paging.** `offset + limit` must not exceed 10,000, the ES
  `max_result_window`, or the route returns 400. The Mongo query had no such
  limit.
- **Facets.**
  - Composite aggregations are paged until exhausted, so no facet is cut
    short.
  - A blank status is dropped.
  - The taxonomy tree is built from the expanded path counts with
    `airs.ts`, a port of ServiceNet's `sharing-contracts/src/airs.ts`. Keep
    the two in step.
  - Contributor names are not in the index. ServiceNet resolves them, as its
    injected resolver does today.

## The deliberate change: text

Mongo matched a case-insensitive substring of `name` only. These routes run a
`multi_match` of type `bool_prefix` with `operator: and` over `name^3`,
`alternateName`, `description` and `organizationName`:

- Every term must appear in one field.
- The last term may be a prefix.
- There is no fuzziness.

Because order stays by name, the `name^3` weight only affects scoring; it does
not change which rows are returned. A substring from the middle of a word no
longer matches. For example, `ood` matched "Food" before and does not now.
