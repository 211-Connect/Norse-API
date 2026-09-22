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

## Values

| Value | Behaviour |
| --- | --- |
| `off` (default) | No cut. Response unchanged, no probe issued, no `relevance_cutoff` key. |
| `on` | Keep results scoring ≥ 20% of the top score. **Can decline to cut.** |

There is no strategy menu. The parameter shipped as one — `score_gap` (first
significant cliff in the score sequence) alongside the fraction-of-max rule —
and measurement settled the question, so the choice is no longer the caller's to
make.

### Why `score_gap` was removed

`score_gap` read the largest arithmetic gap in a score sequence as a relevance
boundary. Real distributions do not contain one. On Santa Cruz `homeless
shelter` the largest gap sits between two relevant shelters; on the same tenant
an Animal Shelter outranks four legitimate ones. A gap in the scores is a gap in
the scores.

Measured on two tenants, 2026-09-19:

| | cut landed inside the unscoped top 20 |
| --- | --- |
| `score_gap` | 30 of 37 cuts |
| fraction-of-max (0.2) | 4 of 30 |

| | returned the unscoped top 20 complete |
| --- | --- |
| `score_gap` | discarded 15 of the top 20 on 7 of 10 query/tenant pairs |
| fraction-of-max (0.2) | 19 of 20 pairs complete |

The unscoped top 20 is a labeller-free stand-in for relevance: a cut that
removes results the ranking itself put at the top is removing results no one
asked it to touch. `score_gap` did have one property the fraction rule lacks —
it cuts noise hard, taking `purple monkey dishwasher` down to 14 services — but
it bought that by cutting real queries just as hard.

The threshold is lax on purpose. At 0.5 the cut landed inside the top 20 on 30
of 37 queries; 0.2 is where it stops removing things the ranking called good.

A fraction-of-max rule needs a true result-set maximum. `hits.max_score` on the
response is the **page** maximum
([ISS-1751](https://linear.app/connect211/issue/ISS-1751)) and is the wrong
denominator; this implementation computes its own from the probe rather than
reading that field.

## How the cut is computed

Only when a cutoff is requested. The probe never walks a fixed window — it asks
Elasticsearch two questions that cost nothing, and only then pays for documents:

1. **Head** — same filters, ranked by relevance, `size: 1`, `_source: false`.
   Returns the top score and the pre-cutoff total.
2. **Count** — `size: 0` with `min_score: 0.2 × top`. Returns how many results
   clear the threshold, in about a millisecond over a 27,000-result population,
   with no documents collected. If that count is ≥ 90% of the matched set the
   distribution is flat and nothing is cut (`no_elbow`); if it exceeds 1,000 the
   cut is located but too large to enumerate (`cut_too_large`).
3. **Survivors** — the same `min_score`, `_source: ['service_id']`, sized to the
   count from step 2. The expensive call is proportional to the cut, not to a
   fixed window.
4. **Main query** — today's query plus an `ids` filter restricting it to the
   surviving documents.

Because the cut point comes from a count rather than a window, it is not limited
to the first N results: on Nebraska 211 the threshold survives at 388 documents
of 27,452 matched, which a 300-candidate window could never have seen. There is
no `candidate_ceiling` outcome any more, because there is no ceiling to hit.

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

### The distinct-service floor

The index is service-at-location grain: one service offered at N locations is N
documents that score near-identically and rank adjacently. A floor counted in
documents is therefore a floor that one provider's branches can fill on their
own — five documents was two actual choices on Santa Cruz `substance abuse
treatment`.

So the floor (`CUTOFF_MIN_KEEP_SERVICES`, 5) is counted in distinct
`service_id`s. When a threshold cut lands on fewer than five services, the probe
fetches a small window (200) and extends the kept set down the ranking until the
fifth distinct service appears. That is the only case in which a window is
fetched at all.

This is *not* deduplication — the duplicate locations are still returned and
still ranked. It only stops the cut from mistaking N locations of one service
for a healthy result set. Deduplication of the leading positions is tracked
separately.

## Response

When (and only when) a cutoff was requested:

```jsonc
{
  "search": { "hits": { "total": { "value": 18 }, "hits": [ /* ... */ ] } },
  "facets": [],
  "relevance_cutoff": {
    "applied": true,
    "reason": null,
    "kept": 18,
    "matched_before_cutoff": 1234,
    "cutoff_score": 81.5,
    "candidates_examined": 18
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
  name invites exactly that, so: compare `cutoff_score` across responses, never
  against a `_score` in the same response.

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
| `no_elbow` | Nothing scored meaningfully below the threshold. The distribution is flat, and returning everything is correct. |
| `below_min_keep` | The matched set is already smaller than the floor. |
| `cut_too_large` | The cut point was located exactly, but keeps more than 1,000 results — more than we will enumerate into an `ids` filter. **This is "found it, too big", not "could not find it".** |

`cut_too_large` is reported separately on purpose, and is the only surviving
member of that family: the old `candidate_ceiling` meant "could not see far
enough to decide", which the `min_score` probe can no longer be in. A checker
that returns green when it could not look is worse than none, because callers
stop looking themselves.

`cut_too_large` is not always a miss. On Nebraska 211 at rank ~1,250, half the
documents come from organizations with a food word in the name and the 988
Suicide & Crisis Lifeline outranks soup kitchens — the outcome there is the
threshold correctly refusing to hand back a cut that big.

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
- **Cuts above 1,000 results are not applied**, only reported. The limit is the
  `ids` filter, not the detection.
- **Two to four Elasticsearch round trips** on the first page of a cutoff
  search — two of them collect no documents at all, and the whole decision is
  cached for subsequent pages.

## Contract

`relevance_cutoff` is an additive optional query param and an additive optional
response object; no existing field changes shape. Per
[AGENTS.md](../AGENTS.md), the OpenAPI document is the contract that generates
the Norse frontend SDK — check `GET /swagger/json` after changing any of this.

If this becomes the default, it belongs in a `v2` handler (`x-api-version: 2`),
not a change to v1. Existing consumers should not find search behaviour changed
underneath them.
