import { decide, finalize } from './engine';
import { req } from '../../common/testing/v2-rules-helpers';
import { RulesRequest, RulesSignals } from './types';

/**
 * Area spread (David, Slack 2026-11-20): 'testing' can mean health care,
 * school or job training, so it asks which area. Scores: ml-broker on the
 * local API :8092, WA_211, 2026-11-20 (read from the start question).
 */
const sig = (scores: Record<string, number>): RulesSignals => ({
  needs: { status: 'ok', scores },
  urgency: { level: 'U-3', score: 0.1 },
  emergency: {
    status: 'ok',
    score: 0.01,
    floor_hit: false,
    calm_context: false,
    dv_shelter: false,
  },
});
const TESTING = {
  'N-HLT': 0.449,
  'N-HLT-07': 0.449,
  'N-LEG': 0.111,
  'N-LEG-04': 0.111,
  'N-WRK': 0.087,
  'N-WRK-02': 0.007,
  'N-LRN': 0.03,
  'N-LRN-01': 0.03,
};
const textReq = (query: string, o: Partial<RulesRequest> = {}) =>
  req({
    has_text: true,
    query,
    content_words: query.trim().split(/\s+/).length,
    ...o,
  });
const run = (
  r: RulesRequest,
  scores: Record<string, number>,
  strong = false,
  count = 10,
) => {
  const d = decide(r, sig(scores), {});
  const by: Record<string, number> = {};
  for (const c of d.count_codes) by[c] = count;
  return finalize(d, {
    counts: { total: 100, by_code: by },
    strong_text_match: strong,
  }).questions;
};

describe('spread question', () => {
  it("'testing' asks which kind, with the areas over the cutoff, best first", () => {
    const qs = run(textReq('testing'), TESTING);
    const s = qs.find((q) => q.id === 'spread');
    expect(s?.stem).toBe('Which kind of testing do you mean?');
    expect(s?.options.map((o) => o.value)).toEqual(['N-HLT', 'N-LEG', 'N-WRK']);
    expect(s?.reason).toBe('area_spread');
    expect(qs[0].id).toBe('spread');
  });

  it('stays with a strong text match', () => {
    const qs = run(textReq('testing'), TESTING, true);
    expect(qs.map((q) => q.id)).toEqual(['spread']);
  });

  it("leaves 'GED testing' alone (a used need)", () => {
    const qs = run(textReq('GED testing'), {
      'N-LRN': 0.99,
      'N-LRN-02': 0.98,
      'N-HLT': 0.2,
    });
    expect(qs.some((q) => q.id === 'spread')).toBe(false);
  });

  it("leaves 'food pantry' alone (Tier 1 used)", () => {
    const qs = run(textReq('food pantry'), {
      'N-FOD': 0.978,
      'N-FOD-01': 0.964,
      'N-ESS': 0.1,
    });
    expect(qs.some((q) => q.id === 'spread')).toBe(false);
  });

  it('is off for a query over maxWords content words', () => {
    const qs = run(textReq('where can i get testing'), TESTING);
    expect(qs.some((q) => q.id === 'spread')).toBe(false);
  });

  it('is off when the request has no content word count', () => {
    const qs = run(req({ has_text: true, query: 'testing' }), TESTING);
    expect(qs.some((q) => q.id === 'spread')).toBe(false);
  });

  it('is off with only one area over the cutoff', () => {
    const qs = run(textReq('testing'), {
      ...TESTING,
      'N-LEG': 0.04,
      'N-WRK': 0.04,
    });
    expect(qs.some((q) => q.id === 'spread')).toBe(false);
  });

  it('is off after a caller need', () => {
    const qs = run(textReq('testing', { needs: ['N-HLT'] }), TESTING);
    expect(qs.some((q) => q.id === 'spread')).toBe(false);
  });

  it('drops when fewer than 2 areas have results', () => {
    const d = decide(textReq('testing'), sig(TESTING), {});
    const qs = finalize(d, {
      counts: { total: 100, by_code: { 'N-HLT': 10, 'N-HLT-07': 10 } },
      strong_text_match: false,
    }).questions;
    expect(qs.some((q) => q.id === 'spread')).toBe(false);
  });
});
