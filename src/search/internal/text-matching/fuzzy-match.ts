import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';

/**
 * Typo tolerance for lexical matching, shared by both search paths.
 *
 * WHY A QUERY PARAMETER AND NOT AN ANALYZER
 * -----------------------------------------
 * The two index families analyse text completely differently. Verified with
 * `_analyze` against the live cluster, 2026-09-22:
 *
 *   text: "veterans housing assistance for homeless seniors"
 *   resources_*  -> veterans, housing, assistance, for, homeless, seniors
 *   hybrid_*     -> veteran, vet, housing, assistance, unhoused, houseless,
 *                   homeless, senior, elderly, old, adult
 *
 * `resources_*` — which 51 of 59 tenant directories use — has no stemming, no
 * stopword removal and no synonyms. Fixing that at the analyzer level means
 * reindexing every tenant, because the index analyzer decides which tokens
 * exist. Fuzziness applies at query time against whatever is already indexed,
 * so one setting behaves identically on both families with no reindex and no
 * mapping change. That is the only reason this can be shared.
 *
 * WHAT IT BUYS, MEASURED
 * ----------------------
 * `resources_en`, largest tenant, 63,580 documents. The classic clause uses
 * `operator: 'AND'`, so every token must match exactly, and with no stemming
 * there is nothing to absorb the variation. One transposed letter returns an
 * empty page, not a degraded one:
 *
 *   hosuing assistance      0 -> 3,115   (Lutheran Social Service Housing …)
 *   dissability             0 -> 5,622   (Disability Advisors, Disability …)
 *   veteran                41 ->   302   (no stemming, so plural is a
 *   seniors             1,591 -> 4,281    different query entirely)
 *
 * WHY A FALLBACK CLAUSE RATHER THAN FUZZINESS ON THE EXISTING ONE
 * ---------------------------------------------------------------
 * Adding `fuzziness` to the clause that already exists changes the scoring of
 * exact matches too, so queries with no typo get reordered for no reason. A
 * separate, heavily de-boosted twin leaves the exact clause untouched: an exact
 * match always outscores a fuzzy one, so this only decides anything when the
 * exact clause matched nothing — which is precisely the broken case.
 *
 * Measured across eight queries that already worked, the fallback leaves every
 * top-5 unchanged except `food`, and that one is a tie: its top eight results
 * all score exactly 5.291, so ES had no basis to order them and the fallback
 * merely breaks the tie differently. Recovery on the typo queries is unaffected
 * by the low boost, because when nothing matches exactly the fallback is the
 * only clause contributing and relative order within it is preserved.
 *
 * WHY prefix_length MATTERS
 * -------------------------
 * `AUTO` allows an edit on a 4-character term, so bare fuzziness makes "food"
 * match "good" — measured, it returned "Good in the 'Hood" and "Hugo Good
 * Neighbors Food Shelf" above real food shelves. Requiring two exact leading
 * characters removes that and costs nothing on the cases that matter: "hosuing"
 * and "dissability" both keep their first two characters.
 */

/** Edit distance scaled to term length: 0 for 1-2 chars, 1 for 3-5, 2 for 6+. */
export const FUZZY_FUZZINESS = 'AUTO' as const;

/**
 * Characters that must match exactly before an edit is allowed. 2 is the
 * smallest value that stops first-character substitution, which is where the
 * damage is — see "food"/"good" above.
 */
export const FUZZY_PREFIX_LENGTH = 2;

/** Cap on how many index terms one fuzzy term may expand to. */
export const FUZZY_MAX_EXPANSIONS = 50;

/**
 * Low enough that an exact match always wins.
 *
 * Swept 1.0 / 0.2 / 0.05 / 0.01 / 0.001 against eight working queries. At 1.0
 * three of them reordered, at 0.2 four, at 0.05 two, and at 0.01 only `food` —
 * which is a tie, not a reordering. Below 0.01 nothing further improves, so
 * this is the point where the fallback stops disturbing queries that already
 * work.
 */
export const FUZZY_FALLBACK_BOOST = 0.01;

/**
 * A de-boosted fuzzy twin of an existing `multi_match` clause, to be added
 * alongside it in the same `should`.
 *
 * Takes the clause rather than a field list so the fallback cannot drift from
 * what it mirrors: same fields, same operator, same `minimum_should_match`, same
 * analyzer. Only the tolerance and the boost differ.
 *
 * Not for phrase, prefix or `constant_score` clauses — fuzziness does not apply
 * to phrase matching, and on curated alias fields an approximate match defeats
 * the point of the curation.
 */
export const fuzzyFallbackFor = (
  clause: QueryDslQueryContainer,
): QueryDslQueryContainer => {
  const base = clause.multi_match;
  if (!base) {
    throw new Error('fuzzyFallbackFor expects a multi_match clause');
  }

  return {
    multi_match: {
      ...base,
      fuzziness: FUZZY_FUZZINESS,
      prefix_length: FUZZY_PREFIX_LENGTH,
      max_expansions: FUZZY_MAX_EXPANSIONS,
      boost: FUZZY_FALLBACK_BOOST,
    },
  };
};
