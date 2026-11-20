import { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import {
  FUZZY_FALLBACK_BOOST,
  FUZZY_PREFIX_LENGTH,
  fuzzyFallbackFor,
  needsTypoClauses,
} from './fuzzy-match';

const base: QueryDslQueryContainer = {
  multi_match: {
    analyzer: 'standard',
    operator: 'and',
    minimum_should_match: '2<75%',
    fields: ['name', 'description'],
    query: 'hosuing assistance',
  },
};

describe('fuzzyFallbackFor', () => {
  it('mirrors every setting of the clause it shadows', () => {
    const fallback = fuzzyFallbackFor(base).multi_match!;

    // Same fields, operator, analyzer and minimum_should_match — the fallback
    // must not quietly search a different shape from the clause it backs up.
    expect(fallback.fields).toEqual(base.multi_match!.fields);
    expect(fallback.operator).toBe(base.multi_match!.operator);
    expect(fallback.analyzer).toBe(base.multi_match!.analyzer);
    expect(fallback.minimum_should_match).toBe(
      base.multi_match!.minimum_should_match,
    );
    expect(fallback.query).toBe(base.multi_match!.query);
  });

  it('adds tolerance and de-boosts, and nothing else', () => {
    expect(fuzzyFallbackFor(base).multi_match).toEqual({
      ...base.multi_match,
      fuzziness: 'AUTO',
      prefix_length: 2,
      max_expansions: 50,
      boost: FUZZY_FALLBACK_BOOST,
    });
  });

  it('leaves the clause it was given untouched', () => {
    const before = JSON.stringify(base);
    fuzzyFallbackFor(base);
    expect(JSON.stringify(base)).toBe(before);
  });

  // The guard that makes fuzziness safe to enable. AUTO allows an edit on a
  // 4-character term, so without this "food" matches "good" — measured against
  // resources_en, bare AUTO put "Good in the 'Hood" above real food shelves.
  it('requires two exact leading characters before allowing an edit', () => {
    expect(FUZZY_PREFIX_LENGTH).toBeGreaterThanOrEqual(2);
  });

  // An exact match must always outscore a fuzzy one, so queries that already
  // work are not reordered. Swept 1.0/0.2/0.05/0.01: above 0.01 real
  // reorderings appear on queries with no typo.
  it('de-boosts far enough that an exact match always wins', () => {
    expect(FUZZY_FALLBACK_BOOST).toBeLessThanOrEqual(0.01);
  });

  it('refuses anything that is not a multi_match', () => {
    expect(() => fuzzyFallbackFor({ term: { name: 'x' } })).toThrow(
      /multi_match/,
    );
  });
});

describe('needsTypoClauses', () => {
  it.each([
    ['every word has 6+ docs', [6, 100, 5000], 3, false],
    ['one word has exactly 5 docs', [5, 100], 2, true],
    ['one word has 0 docs', [0, 100], 2, true],
    ['one word has 1 doc', [1], 1, true],
    ['single common word', [6], 1, false],
    ['no content words', [], 0, true],
    ['12 content words, all common', Array(12).fill(900), 12, true],
    ['13 content words, all common', Array(12).fill(900), 13, true],
    ['11 content words, all common', Array(11).fill(900), 11, false],
  ])('%s', (_name, docs, count, expected) => {
    expect(needsTypoClauses(docs as number[], count as number)).toBe(expected);
  });
});
