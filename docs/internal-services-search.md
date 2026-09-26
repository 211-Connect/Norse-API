# Internal services search and facets

ServiceNet's record selector lists and facets services through two internal
routes over the shared Elasticsearch `services` index. The index is loaded by
Dagster `configurable-readers` (Dagster PR #601, ISS-1867). See
architecture-docs ADR 0023 (ArchitectureDocs PR #31) and INTEG-022.

| Route | Body | Returns |
| --- | --- | --- |
| `POST /internal/services/search` | `resourceWriterIds` (required), `filter.taxonomyCodes`, `filter.statuses`, `filter.geography.regionIds` and `filter.geography.points` (1 to 20 Places together; see [geography-filter.md](geography-filter.md)), `filter.virtual`, `filter.match`, `text`, `cursor`, `limit` (default 50, max 200) | `{ items, total, limit, nextCursor }` |
| `POST /internal/services/facets` | `resourceWriterIds` (required), `filter.geography.regionIds`, `filter.geography.points`, `filter.virtual`, `filter.match` | `{ contributors, statuses, taxonomy }` |

Send `x-api-version: 1`, as for every versioned route, and
`x-internal-api-key`. No `x-tenant-id`: the
writer set is the scope, as it was in the Mongo query, and one writer's records
can sit under several tenants.

## Status

- **Unpublished.** `@ApiExcludeController()` keeps both routes out of
  `/swagger/json`, so the Norse SDK never sees them.
  `service-search.controller.spec.ts` checks the generated document.
- **Internal key, not tenant scope.** They trust the writer set they are
  given, so they are not tenant-scoped (`@NotTenantScoped()`). Every call
  needs `x-internal-api-key` equal to `INTERNAL_API_KEY`, on the gateway path
  (a key with `norse-api.invoke`) and on `api.c211.io` / `api-dev.c211.io`
  alike; an unset key rejects everything. ISS-1887 is defence in depth. See
  [geography-filter.md](geography-filter.md#auth-the-internal-key-not-a-tenant).

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
- **Geography and virtual** (ISS-1873, ISS-1874) are not in the Mongo
  source. Regions are OR'ed `geo_shape` `intersects` clauses on
  `service_area` against the indexed Region shape; an unknown Region id is
  400. `virtual` is `all`, `only` (`locationTypes` has `virtual`) or
  `exclude` (`locationTypes` has `physical`). Both also narrow facets. The
  rules, a request example and the error mapping are in
  [geography-filter.md](geography-filter.md#geography-and-virtual-clauses).

  ```json
  {
    "resourceWriterIds": ["5334599c-1be1-4e55-bf86-1f19d56e9da4"],
    "filter": {
      "geography": { "regionIds": ["state:MO"] },
      "virtual": "only"
    }
  }
  ```
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
  query or sort mode returns 400. The query fingerprint covers the writer
  set, taxonomy, statuses, text, Region ids and virtual mode. The four lists
  are treated as sets (sorted and de-duplicated), so the same set in another
  order is the same query, with the same `preference`.
- The service asks ES for `limit + 1` hits. That extra hit tells it whether a
  next page exists, so a full last page still returns a null cursor.
- `serviceId` is the final sort key in both orders. Without it, a page
  boundary inside a tie would skip or repeat records. That tie-breaker is
  necessary but not sufficient: it only holds while every page reads the
  same shard copies (next point).
- **Every search request carries `preference`**, the first page included:
  `services-<query fingerprint>`. It is derived from the query, never from
  the page, so all pages of one query go to the same shard copies, and
  different queries still spread across copies.
  - Why: a primary and its replica hold different numbers of deleted docs
    (measured on production: 117k vs 96k), so BM25 gives the same document a
    different `_score` on each copy. Without a preference each page could
    hit a different copy, and `search_after` on `_score` then skips and
    repeats records. Measured before the fix: "food*" had a total of 1,686,
    one walk returned 229 duplicates and never showed about 150 records, and
    two walks of "food pantry" returned different pages.
  - Name order has no score, but carries the preference too, so a copy that
    lags on a refresh cannot shift a page boundary either.
  - Facets send the preference of their unfiltered listing (the fingerprint
    with no text, taxonomy or statuses) on every composite page, so facet
    counts and that listing's `total` read the same copies.
  - If a pinned copy goes away (node restart, relocation), ES falls back to
    another copy and paging can skip or repeat once. Restarting the walk fixes it.
  - Not point-in-time: the read-only live-test guard refuses PIT, and a PIT
    needs open/close lifecycle management that these stateless routes do
    not have.
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
