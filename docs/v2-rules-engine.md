# v2 clarification rules engine (`src/v2/rules/`)

Pure, deterministic TypeScript that decides what `/v2/search` asks after the models run. No model, no I/O, no state: the URL carries every answer, so the same input always gives the same output. Called by `GET /v2/search` (ISS-2499, see v2-search.md). Ticket: ISS-2697.

## Two calls around the search
- `decide(request, signals, tenant)` runs before Elasticsearch. It returns the internal emergency band (`emergency_band`, never in the response) and the cache rule (`cacheable`), the need states (`use` boosts, `ask` becomes an option, the rest is dropped), the urgency state, the candidate questions, and `count_codes`: the need codes the search must count.
- `finalize(decision, { counts, strong_text_match })` runs after the search. It drops options with 0 results and questions whose answer changes nothing, ranks, and returns at most 3 questions. `counts.by_code` is either an object (the codes were counted: a code missing from it has 0 results, since an Elasticsearch terms aggregation leaves out zero-count buckets) or `null` (not counted: not built yet, `clarify=never`, or the count failed; every option is kept, without a count). `strong_text_match` (the query names a service or place well, e.g. "alcoholics anonymous") drops every needs question; the emergency and time questions stay.

Needs never filter results; a used or confirmed need only boosts (`boost_needs`, never a Tier 1 together with its Tier 2).

## Inputs
- Request: `has_text`, `needs` (confirmed, URL order; Tier 1 or Tier 2 codes only, `N-X` is rejected with 400), `passed_needs` (still accepts `N-X`), `urgency` (`U-X` means "not yet known" and counts as absent: the engine behaves as if none was sent), `clarify` (`never` keeps only the emergency question).
- Signals from ml-broker `search-classification`: 91 need scores (74 Tier 2, 16 Tier 1, `N-X`), top-level `urgency` `{level, score}` (beside `needs`, as ml-broker sends it; read only when the needs call succeeded), emergency `{status, score, floor_hit, calm_context, dv_shelter}`; `emergency: null` when there is no typed text.
- Tenant: `top_areas` (Tier 1 codes by service count, for the starting question) and `hotlines`.

## Cutoffs (`config.ts`, `RULES_VERSION`)
- Emergency, in order: floor hit -> popup at score >= 0.662, else soft; calm context -> soft at >= 0.221, else none; DV shelter below 0.662 -> soft; >= 0.662 popup; >= 0.221 soft; else none. Error -> `unknown`, not cacheable.
- Cache rule (`cacheable`, ADR 0039 Decision 28): true only when the band is `none`, there is no emergency question (a caller `urgency=U-0` adds one with band `none`), and the needs call succeeded.
- Urgency: a caller level other than `U-X` is confirmed (`use`); `U-X` from the caller is ignored. From the model: < 0.8 drop (U-X); 0.8 to 0.93 ask; >= 0.93 use the model level.
- Needs: >= 0.97 use; Tier 2 from 0.12 to 0.97 ask; below 0.12 drop.
- Area rule: best Tier 1 >= 0.9 and every Tier 2 < 0.5 -> one area question.
- N-X means "need not yet known". It is internal: it is never an option and has no label. `nx` in the decision is true when no need is used and N-X scores >= 0.07, or the engine is given `N-X` as a confirmed need.
A cutoff or rule change bumps `RULES_VERSION`.

## Questions
| Step (info) | Id | Importance | When |
|---|---|---|---|
| 0 | `emergency` | critical | band popup or soft and no `urgency` in the URL; stem "Are you in danger right now?"; options `U-1` "Yes, I am in danger" and `U-3` "No, I am safe now" (same labels in both bands); carries the hotlines |
| 0 | `emergency` | critical | caller `urgency=U-0`, any band; no options, only the hotlines (`callerU0EmergencyQuestion`, built on an unconfirmed reading of ADR 0039 Decision 50) |
| 1 | `urgency_today` | high | urgency ask and the model level is U-1 |
| 2 | `start` | high | no need at all; model areas when the best Tier 1 >= 0.3, else the tenant's top areas |
| 3 | `area:<T1>` | high | a Tier 1 was picked (`needs=N-HOU`) or the area rule fired; top 3 Tier 2 by score |
| 4 | `narrow:1` | medium | Tier 2 needs in the ask band, top 3 |
| 5 | `urgency_time` | low | urgency ask with another level |
| 6 | `narrow:2` | low | the next 3 ask-band needs |
| 7 | `narrow:1` | low | as step 4 (`narrow:1`), when a Tier 2 need is already used (any source); stem 'Do any of these also fit?' |
| 8 | `narrow:2` | low | as step 6 (`narrow:2`), when a Tier 2 need is already used; stem 'Do any of these also fit?' |
Tenant AI classification off (`TenantContext.ai_classification: 'off'`, Lucas 2026-11-13): the engine drops the model's need and urgency guesses and keeps only the `emergency` question. Caller `needs` and `urgency` still count. The emergency check always runs. The route sends `on` until Norse-API can read the tenant setting.

No option offers `U-0`: a person in danger taps a hotline number (ADR 0039 Decision 54). A caller `U-1` to `U-4` removes the emergency question; `U-X` counts as no answer (Decision 51). `clarify=never` never removes it (Decision 26). The response has no top-level `emergency` block.

Each option is `{label, parameter, value, results_count}` (ADR 0039 Decision 55). `results_count` is the number of matching services, or `null` when the server did not count (all urgency options; need options when no count ran). Null means not counted; a counted code that is missing means 0, and a 0-count option is never offered. `parameter` is the URL parameter a pick adds: `needs` (start, area and narrow options) or `urgency` (emergency and time options). The question has no `parameter`. `passed_needs` is in the enum, but no option emits it today: "None of these" stays the `none_of_these` flag, and the client sends the shown codes in `passed_needs`.

Needs questions allow several picks, an "Other" text box and "None of these". A confirmed Tier 2 need locks its area; a passed need is never offered again; an area with an area question gives no options to a narrow question in the same response. Importance tells the client how much a question matters; the engine still returns up to 3, ranked by `priority` (see Order), and never drops a question for low importance. The client (Norse) shows at most 3 questions before results.

## Order
Each question has a `priority`. The engine sorts high to low, then by id, and keeps the first 3.
- `priority = BAND_BASE[importance] + value`. Bases: critical 3, high 2, medium 1, low 0. `value` is in [0, 0.999], so a band never passes the band above it.
- `value = uncertainty x effort x split`, rounded to 3 places and capped at 0.999.
- Uncertainty, `emergency`: `4p(1-p)` of the emergency score (0.5 when it is missing).
- Uncertainty, `urgency_today` and `urgency_time`: `4p(1-p)` of the urgency score (0.5 when it is missing).
- Uncertainty, `start` and `area:*`: normalized entropy of the model scores of the need options, without N-X.
- Uncertainty, `narrow:*`: mean of `4p(1-p)` over the need options, without N-X; 0 when there is none.
- Effort: `1 - 0.05 x (options - 2)`, between 0.8 and 1. "None of these" does not count as an option.
- Split: with one counted option, `1 - 2 x |count / total - 0.5|`; with two or more, the normalized entropy of the option counts (even counts give 1, one dominant option gives near 0). Between 0 and 1. It is 1 when no option has a count (urgency questions, or `decide` before `finalize`).
- `decide` fills `uncertainty`, `value` and `priority` with split 1, and keeps each option's model score in `option_scores` (internal, not in the response). `finalize` recomputes `value` and `priority` after it drops options; when a question lost options, it first recomputes `uncertainty` over the options left, so a question cut to one option has uncertainty 0.
- `emergency` is the only critical question, so it stays first.
- `step` stays in the output for information only. It no longer sorts.

## Tests
`npx jest src/v2/rules`. `engine.spec.ts` runs the 40 real model outputs in `__fixtures__/golden-scores.json` (copied from ml-broker's golden file) 1,000 times each and checks the output never changes.

The question has no `level` field (Lucas, 2026-11-13). A client reads `importance` and `type` to choose the display. The popup and soft bands of the emergency question give the same `type`, `importance`, `reason`, stem, options and hotlines; only the score-derived `uncertainty`, `value` and `priority` differ, and those are not a band label.
