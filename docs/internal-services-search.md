# Internal services search and facets

ServiceNet's record selector lists and facets services through two internal
routes over the shared Elasticsearch `services` index. The index is loaded by
Dagster `configurable-readers` (Dagster PR #601, ISS-1867). See
architecture-docs ADR 0023 (ArchitectureDocs PR #31) and INTEG-022.

| Route | Body | Returns |
| --- | --- | --- |
| `POST /internal/services/search` | `resourceWriterIds` (required), `filter.taxonomyCodes`, `filter.statuses`, `text`, `cursor`, `limit` (default 50, max 200) | `{ items, total, limit, nextCursor }` |
| `POST /internal/services/facets` | `resourceWriterIds` (required) | `{ contributors, statuses, taxonomy }` |

Send `x-api-version: 1`, as for every versioned route. No `x-tenant-id`: the
writer set is the scope, as it was in the Mongo query, and one writer's records
can sit under several tenants.

## Status

- **Unpublished.** `@ApiExcludeController()` keeps both routes out of
  `/swagger/json`, so the Norse SDK never sees them.
  `service-search.controller.spec.ts` checks the generated document.
- **Unauthenticated.** They trust the writer set they are given. Auth is
  ISS-1876. ISS-1887 blocks `/internal/*` at the gateway, and these
  routes must not deploy before it lands.

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
- **Order without text.** Results are sorted by `name.raw` ascending with a
  missing name first, then by `serviceId`. `name.raw` is a case-sensitive
  keyword, so this is Mongo's binary order.
- **Total.** `track_total_hits: true` makes `total` count every match instead
  of stopping at 10,000.
- **Paging.** Paging uses a cursor, not an offset (see below), so there is no
  10,000-row ceiling. Mongo paged with `skip`/`limit`.
- **Facets.**
  - Composite aggregations are paged until exhausted, so no facet is cut
    short.
  - A blank status is dropped.
  - The taxonomy tree is built from the expanded path counts with
    `airs.ts`, a port of ServiceNet's `sharing-contracts/src/airs.ts`. Keep
    the two in step.
  - Contributor names are not in the index. ServiceNet resolves them, as its
    injected resolver does today.

## Paging: cursors

- The first request has no `cursor`. Every response carries `nextCursor`,
  which is null on the last page. To get the next page, send it back with
  the **same** writer set, filter and text.
- A cursor is the last hit's sort values for `search_after`, the sort mode,
  and a fingerprint of the query, base64url-encoded. It is not signed: the
  writer set is the caller's own input, so a forged cursor can only move a
  position within results the caller could already request.
- A cursor that doesn't decode, has the wrong shape, or came from a different
  query or sort mode returns 400.
- The service asks ES for `limit + 1` hits. That extra hit tells it whether a
  next page exists, so a full last page still returns a null cursor.
- `serviceId` is the final sort key in both orders. Without it, a page
  boundary inside a tie would skip or repeat records.
- No point-in-time is held. If Dagster reloads the index while someone is
  paging, the next page reflects the new data.

## The deliberate changes: text matching and text ordering

Mongo matched a case-insensitive substring of `name` only, and kept name
order. These routes OR two matches:

- A contains match on `name.substring`, a `wildcard`-typed subfield that
  Dagster #601 adds. The query is `*<text>*` with `case_insensitive: true`.
  The field has no normalizer, so dropping `case_insensitive` would make the
  match case-sensitive. `\`, `*` and `?` in the text are escaped, so they
  match literally. This keeps Mongo's mid-word matching: "ood" finds "Food".
- A `multi_match` of type `bool_prefix` with `operator: and` over `name^3`,
  `alternateName`, `description` and `organizationName`. Every term must
  appear in one field, and the last term may be a prefix. There is no
  fuzziness.

**With text, results are ordered by `_score` descending, then `serviceId`.**
This is a deliberate change from Mongo. It is also what makes the `name^3`
weight visible.
