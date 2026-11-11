# v2 clarification rules engine (`src/v2/rules/`)

Pure, deterministic TypeScript that decides what `/v2/search` asks after the models run. No model, no I/O, no state: the URL carries every answer, so the same input always gives the same output. Not wired into a route yet (ISS-2499, v2 search). Ticket: ISS-2697.

## Two calls around the search
- `decide(request, signals, tenant)` runs before Elasticsearch. It returns the emergency band and cache rule, the need states (`use` boosts, `ask` becomes an option, the rest is dropped), the urgency state, the candidate questions, and `countCodes`: the need codes the search must count.
- `finalize(decision, { counts, strongTextMatch })` runs after the search. It drops options with 0 results and questions whose answer changes nothing, ranks, and returns at most 3 questions. `strongTextMatch` (the query names a service or place well, e.g. "alcoholics anonymous") drops every needs question; the emergency and time questions stay.

Needs never filter results; a used or confirmed need only boosts (`boostNeeds`, never a Tier 1 together with its Tier 2).

## Inputs
- Request: `hasText`, `needs` (confirmed, URL order), `passedNeeds`, `urgency`, `clarify` (`never` keeps only the emergency question).
- Signals from ml-broker `search-classification`: 91 need scores (74 Tier 2, 16 Tier 1, `N-X`), urgency `{level, score}`, emergency `{status, score, floorHit, calmContext, dvShelter}`; `emergency: null` when there is no typed text; `dictionaryNeeds` (term to need) for later.
- Tenant: `topAreas` (Tier 1 codes by service count, for the starting question) and `hotlines`.

## Cutoffs (`config.ts`, `RULES_VERSION`)
- Emergency, in order: floor hit -> popup at score >= 0.662, else soft; calm context -> soft at >= 0.221, else none; DV shelter below 0.662 -> soft; >= 0.662 popup; >= 0.221 soft; else none. Error -> `unknown`, not cacheable.
- Urgency: < 0.8 drop (U-X); 0.8 to 0.93 ask; >= 0.93 use the model level.
- Needs: >= 0.97 use; Tier 2 from 0.12 to 0.97 ask; below 0.12 drop.
- Area rule: best Tier 1 >= 0.9 and every Tier 2 < 0.5 -> one area question.
- N-X ("a specific place or organization") is an option at score >= 0.07.
A cutoff change bumps `RULES_VERSION`.

## Questions, in order
| Step | Id | Level | When |
|---|---|---|---|
| 0 | `emergency` | red | band popup or soft and no `urgency` in the URL; carries the hotlines |
| 1 | `urgency_today` | orange | urgency ask and the model level is U-1 |
| 2 | `start` | orange | no need at all; model areas when the best Tier 1 >= 0.3, else the tenant's top areas |
| 3 | `area:<T1>` | orange | a Tier 1 was picked (`needs=N-HOU`) or the area rule fired; top 3 Tier 2 by score |
| 4 | `narrow:1` | low | Tier 2 needs in the ask band, top 3 |
| 5 | `urgency_time` | low | urgency ask with another level |
| 6 | `narrow:2` | low | the next 3 ask-band needs |
Inside a step, the question whose biggest option is closest to half of the results goes first. Needs questions allow several picks, an "Other" text box and "None of these". A confirmed Tier 2 need locks its area; a passed need is never offered again; an area with an area question gives no options to a narrow question in the same response. The client (Norse) shows at most 3 questions before results.

## Tests
`npx jest src/v2/rules`. `engine.spec.ts` runs the 40 real model outputs in `__fixtures__/golden-scores.json` (copied from ml-broker's golden file) 1,000 times each and checks the output never changes.
