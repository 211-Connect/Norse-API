# Relevance cutoff (`relevance_cutoff`)

Opt-in trimming of low-relevance results from hybrid search. Tracked as
[ISS-1752](https://linear.app/connect211/issue/ISS-1752).

## What this solves, and what it does not

A food query in a small rural town returns 1,200 results. Stakeholders do not
review 1,200 resources — they look at the number, conclude the search is wrong,
and stop giving feedback. That silence is the actual problem: it starves
[ISS-1378](https://linear.app/connect211/issue/ISS-1378) of the labeled query
sets that would let us measure relevance at all.

**This feature cuts the list. It does not reorder it.** If the most relevant
result sits at position 900, a cutoff hides it rather than surfacing it. That
trade was made knowingly — a result set small enough to be reviewed produces
"you're missing X", and X becomes a test case. Do not read this feature as
relevance being solved.

## Default behaviour is unchanged

`relevance_cutoff` defaults to `off`. With it absent or `off`:

- the Elasticsearch request is identical to what it was before this feature,
- no probe query is issued,
- the response document contains no `relevance_cutoff` key.

This is enforced by tests in `src/search/hybrid-search.relevance-cutoff.spec.ts`
(`when the caller does not opt in`). If those go red, something changed for
consumers who never asked for it.

Activation belongs to the caller. Norse reads the tenant's Payload flag and
decides whether to send the param; external consumers through the API gateway
keep v1 behaviour until they opt in themselves. Norse-API does not read a tenant
config to turn this on, deliberately — a flag flipped in a CMS should not change
what a published API returns to a consumer who never asked.

## Strategies

| Value | Behaviour |
| --- | --- |
| `off` (default) | No cut. Response unchanged. |
| `score_gap` | Keep results above the first significant cliff ("elbow") in relevance score. **Can decline to cut.** |
| `relative_to_max` | Keep results scoring ≥ 50% of the top score. Always cuts. |

The difference that matters: `score_gap` can decline. When every result is
uniformly mediocre there is no elbow, and returning everything is the honest
answer. `relative_to_max` has no way to express "nothing here is good enough" —
by construction its top result is always 1.0. Both ship so they can be compared
on identical queries, as agreed at standup 2026-09-17.

`relative_to_max` needs a true result-set maximum. `hits.max_score` on the
response is the **page** maximum
([ISS-1751](https://linear.app/connect211/issue/ISS-1751)) and is the wrong
denominator; this implementation computes its own from the probe rather than
reading that field.

## How the cut is computed

Two Elasticsearch queries, only when a cutoff is requested:

1. **Probe** — same filters, ranked by relevance, `size: 300`, `_source: false`,
   `sort: ['_score']`. Returns a score sequence and the pre-cutoff total.
2. **Main query** — today's query plus an `ids` filter restricting it to the
   surviving documents.

The probe is cached (Redis, via `RequestCacheService`) on everything that
affects ranking — including the tenant's `pinned_resources_mode`, which changes
whether the pinned boost clause is emitted at all — but not on `page`, `limit`
or `sort`, so pages 2..n of one search reuse a single probe and the kept set
cannot drift between pages.

The TTL is **5 minutes**, not `RequestCacheService`'s one-hour default. Holding
a decision only has to outlive someone paging through results; a longer window
is pure exposure. The readers reindex blue/green, and a reindex inside the TTL
changes scores and can delete documents, so `relevance_cutoff.kept` would report
a number the main query no longer returns. Document `_id`s are stable
(`{tenant}:{sal}:{lang}`), so the `ids` filter still resolves — it resolves to a
stale decision, silently, which is the worse failure.

Two ranking inputs cannot be keyed: the query embedding and the predicted
taxonomy codes. Both are functions of `queryStr` and tenant, so they are stable
for a stable model, but they move when the embedding model is swapped or when
ml-broker's per-tenant vocabulary changes (ISS-1755). The short TTL is the only
thing bounding that staleness.

### Geography never participates in the cut

The probe scores **lexical + vector + taxonomy + pinned only**. `gauss(distance)`
is deliberately absent, and this is the reason a separate pass exists rather than
reading scores off the main query.

In the fused hybrid score, the geo term spans a 0–25 range
(`GEO_GAUSS_WEIGHT`), so an elbow found there is partly an elbow in *distance*.
That fails in both directions, and worst for the population this feature is meant
to help:

- **Dense geography** — `gauss` spans its full range and manufactures score
  discontinuities that are distance cliffs, not relevance cliffs → spurious cuts.
- **Sparse geography** — everything is far, `gauss` is uniformly small, the score
  range compresses and the elbow weakens or vanishes → little or no cut, for
  exactly the users who most need a shorter list.
- **Coordinate-less documents** — ES decay functions have no `missing` option, so
  these score `gauss = 1.0` and collect the full weight of 25
  ([ISS-1403](https://linear.app/connect211/issue/ISS-1403)). Under a geo-inclusive
  cut they would survive preferentially, which no one decided.

It is also wrong on the merits. Someone in a rural area may well drive 40 miles
for the right resource. How far a person is willing to travel is their own
decision, expressed through `distance` and `geo_type` — it is not evidence that a
resource is irrelevant. **Proximity remains a filter and a ranking signal; it
never decides what gets cut.**

Because the cut is applied as a membership filter rather than a score threshold,
it also stays coherent under `sort=distance|name|organization`, where the
returned hits are not in score order and a cut walking the response list would be
measuring nothing.

### The detector

`src/search/internal/relevance-cutoff/detect-cutoff.ts`. Pure, no Elasticsearch,
unit-tested in `detect-cutoff.spec.ts`.

For `score_gap`, a split is accepted only if it clears two guards:

| Guard | Default | Purpose |
| --- | --- | --- |
| `significance` | 3 | The gap must exceed 3× the median adjacent gap. |
| `minRelativeDrop` | 0.15 | ...and must drop ≥15% of the score it falls from. |
| `minKeep` | 5 | Floor: the accepted split is raised to this, never lowered. |

`significance` is what buys the decline-to-cut property: on a flat distribution
every gap is close to the median gap, the ratio sits near 1, and the detector
returns "no elbow". `minRelativeDrop` rejects the opposite failure — a
numerically large gap that is trivial relative to the scores around it.

**The detector takes the first qualifying cliff, not the largest one.** Largest
gap is the obvious reading of "biggest discontinuity" and it does not survive
contact with the data. Measured against Santa Cruz County (tenant `303ba4e4…`)
on 2026-09-18, one `food` query's cut moved as the search radius grew by a mile
at a time:

| radius | 6 mi | 7 mi | 8 mi | 9 mi | 15 mi | 20 mi |
| --- | --- | --- | --- | --- | --- | --- |
| kept (largest gap) | 10 | 19 | **6** | **40** | 10 | 13 |
| kept (first cliff) | 6 | 6 | 6 | 7 | 9 | 13 |

Whichever single gap happens to be widest wins under argmax, so admitting a
handful of documents into the leading gap collapses it and the choice jumps to
an unrelated split deep in the tail. Under the first-cliff rule every radius cuts
at the same semantic boundary — the last real food pantry — and the count grows
only as more food pantries come into range.

`minKeep` is a floor applied **after** the cliff is chosen. Searching only from
the floor downward was the original implementation and it was wrong in a way
worth recording: when the true elbow sat above the floor, the detector skipped it
and settled on a far weaker split below, silently and with `applied: true`. On
the live `food` query that produced a 43-result cut that kept a bilingual
education program and dropped a meal delivery service.

Each guard, and the clamp, has a test that fails when only that behaviour is
reverted; they were verified by breaking each one and watching the right test go
red.

## Response

When (and only when) a cutoff was requested:

```jsonc
{
  "search": { "hits": { "total": { "value": 18 }, "hits": [ /* ... */ ] } },
  "facets": [],
  "relevance_cutoff": {
    "strategy": "score_gap",
    "applied": true,
    "reason": null,
    "kept": 18,
    "matched_before_cutoff": 1234,
    "cutoff_score": 81.5,
    "candidates_examined": 300
  }
}
```

- **`hits.total` reports the kept count** when `applied` is true. The whole
  complaint was the number 1,200; a cut that leaves that number unmoved does not
  solve the UX problem.
- **`matched_before_cutoff`** preserves the original so a consumer can say
  "showing 18 of 1,234" rather than pretending 1,234 was never true.
- **`cutoff_score`** is on the wire from day one so a shipped threshold can be
  evaluated retroactively against real traffic, instead of requiring every query
  to be re-run once ISS-1378's labeled set exists.

  **It is a probe score, and the probe is not scored like the main query.** The
  probe deliberately omits the distance decay (0–25 points) and the priority
  boost, so `cutoff_score` is systematically lower than the `_score` the same
  document carries in `hits`. Comparing the two is meaningless and the field
  name invites exactly that, so: compare `cutoff_score` across responses using
  the same strategy, never against a `_score` in the same response.

### `hits.total` changes meaning, and that is the point

`total` counts kept results rather than matched ones whenever `applied` is
`true`. This is not a stylistic choice — the cut is implemented as an `ids`
membership filter, so the kept set *is* the population the caller can page
through. A `total` of 1,234 over a pageable set of 18 would make any client
computing `ceil(total / limit)` render 21 empty pages.

The consequence worth planning for is downstream of the API: **anything that
aggregates `total` across requests will mix two populations** — analytics
comparing result counts over time, dashboards, a CDN or gateway keyed on the
query string. The response is self-describing (the `relevance_cutoff` object is
present exactly when the meaning changed, and `matched_before_cutoff` carries
the other number), so the fix on the consumer side is to branch on that object's
presence rather than to assume `total` is stable.

### `applied: false` is not a failure

| `reason` | Meaning |
| --- | --- |
| `no_elbow` | The detector looked and there was no cliff. Returning everything is correct. |
| `below_min_keep` | The matched set is already small. |
| `candidate_ceiling` | Any cliff lies beyond the 300 examined candidates. **This is "could not determine", not "nothing to cut".** |

`candidate_ceiling` is reported separately on purpose. A checker that returns
green when it could not look is worse than none, because callers stop looking
themselves.

## Pagination

The cut applies to the result set, not the page. If the cut leaves 18 results and
a caller requests `page=2`, they get an empty `hits` array and `total: 18` —
consistent with any other over-the-end request, not a special case.

## Pinned resources

Pinned resources carry their boost in the probe regardless of the tenant's
`pinned_resources_mode`, so curated resources rank high and survive the cut. A
tenant that pinned a resource does not expect a relevance heuristic to drop it.

## Known limitations

- **The cut favours precision over recall at these defaults.** In the Santa Cruz
  observation run, 8 queries × 2 geographies cut 512 matches down to 5–17 results,
  and every kept set was on-topic; the results dropped just below the boundary
  were topic-adjacent rather than junk (for `domestic violence shelter`: five
  shelters kept, advocacy/legal/youth-housing dropped). Whether that boundary is
  in the right place is exactly what ISS-1378's labeled set has to settle.
- **The thresholds are arbitrary** until ISS-1378 produces a stakeholder-labeled
  set. Everyone at the standup said so; shipping on arbitrary defaults was the
  agreed plan. What makes it recoverable is that `cutoff_score`, `kept` and
  `matched_before_cutoff` ship with it.
- **Validation needs a dense *and* a sparse geography, measured separately**, for
  both false-positive (dropped a good result) and false-negative (kept junk)
  rates. The geo coupling above predicts the two diverge; a threshold validated
  on urban queries alone tells you nothing about rural ones.
- **The 300-candidate ceiling** means a cliff at position 900 is never found.
  Reported honestly as `candidate_ceiling` rather than approximated.
- **Two Elasticsearch round trips** on the first page of a cutoff search. The
  probe carries no `_source` and no aggregations, and is cached for subsequent
  pages.

## Contract

`relevance_cutoff` is an additive optional query param and an additive optional
response object; no existing field changes shape. Per
[AGENTS.md](../AGENTS.md), the OpenAPI document is the contract that generates
the Norse frontend SDK — check `GET /swagger/json` after changing any of this.

If this becomes the default, it belongs in a `v2` handler (`x-api-version: 2`),
not a change to v1. Existing consumers should not find search behaviour changed
underneath them.
