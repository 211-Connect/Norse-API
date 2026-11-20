import { req, sig } from '../../common/testing/v2-rules-helpers';
import { CUTOFFS } from './config';
import { isWeakMatch } from './weak-match';
import { RulesRequest, RulesSignals } from './types';

type Input = Parameters<typeof isWeakMatch>[0];

const quiet = { keyword_top: 0.5, vector_top: 0.3 };
const weak = (over: Partial<Input> = {}): boolean =>
  isWeakMatch({
    req: req(),
    signals: sig({ 'N-FOD': 0.2 }),
    ai: 'on',
    judges: quiet,
    has_content_word_raw: true,
    ...over,
  });

describe('isWeakMatch (signal D, Lucas 2026-11-18)', () => {
  it('cutoffs: keyword 1, need 0.9, vector 0.55', () => {
    expect(CUTOFFS.weakMatch).toEqual({
      keywordBelow: 1,
      needBelow: 0.9,
      vectorBelow: 0.55,
    });
  });

  it('all judges quiet: weak', () => {
    expect(weak()).toBe(true);
  });

  describe('rule 1: text and AI on', () => {
    it('no text: not weak', () => {
      expect(weak({ req: req({ has_text: false }) })).toBe(false);
    });
    it('AI classification off: not weak', () => {
      expect(weak({ ai: 'off' })).toBe(false);
    });
  });

  describe('rule 2: needs status', () => {
    it('needs error: not weak', () => {
      const signals: RulesSignals = {
        needs: { status: 'error' },
        emergency: { status: 'ok', score: 0.001, floor_hit: false },
      };
      expect(weak({ signals })).toBe(false);
    });
  });

  describe('rule 3: emergency is calm', () => {
    const emergency = (e: RulesSignals['emergency']) =>
      sig({ 'N-FOD': 0.2 }, { emergency: e });
    it('popup band: not weak', () => {
      expect(weak({ signals: emergency({ status: 'ok', score: 0.9 }) })).toBe(
        false,
      );
    });
    // Signal D as measured: only the popup band or a floor hit protects the
    // text; a soft card still shows next to the empty results ("help").
    it('soft band: can be weak', () => {
      expect(weak({ signals: emergency({ status: 'ok', score: 0.3 }) })).toBe(
        true,
      );
    });
    it('unknown band (emergency error): not weak', () => {
      expect(weak({ signals: emergency({ status: 'error' }) })).toBe(false);
    });
    it('floor hit: not weak', () => {
      expect(
        weak({
          signals: emergency({ status: 'ok', score: 0.001, floor_hit: true }),
        }),
      ).toBe(false);
    });
    it('caller urgency U-0: not weak', () => {
      expect(weak({ req: req({ urgency: 'U-0' }) })).toBe(false);
    });
    it('no emergency check (null): calm', () => {
      expect(weak({ signals: emergency(null) })).toBe(true);
    });
  });

  describe('rule 4: keyword judge K < 1', () => {
    it('K = 1: not weak', () => {
      expect(weak({ judges: { keyword_top: 1, vector_top: 0 } })).toBe(false);
    });
    it('K = 0.99: weak', () => {
      expect(weak({ judges: { keyword_top: 0.99, vector_top: 0 } })).toBe(true);
    });
    it('no content word forces K = 0: weak even with keyword_top 500', () => {
      expect(
        weak({
          judges: { keyword_top: 500, vector_top: 0.3 },
          has_content_word_raw: false,
        }),
      ).toBe(true);
    });
    it('no content word does not rescue a loud need or vector judge', () => {
      expect(
        weak({
          has_content_word_raw: false,
          signals: sig({ 'N-FOD': 0.95 }),
        }),
      ).toBe(false);
    });
  });

  describe('rule 5: need judge N < 0.9', () => {
    it('N = 0.9: not weak', () => {
      expect(weak({ signals: sig({ 'N-FOD': 0.9 }) })).toBe(false);
    });
    it('N = 0.89: weak', () => {
      expect(weak({ signals: sig({ 'N-FOD': 0.89 }) })).toBe(true);
    });
    it('N-X is left out', () => {
      expect(weak({ signals: sig({ 'N-X': 0.99, 'N-FOD': 0.1 }) })).toBe(true);
    });
    it('no scores: N = 0, weak', () => {
      expect(weak({ signals: sig({}) })).toBe(true);
    });
    it('uses the max over codes', () => {
      expect(weak({ signals: sig({ 'N-FOD': 0.1, 'N-HOU': 0.95 }) })).toBe(
        false,
      );
    });
  });

  describe('rule 6: vector judge V < 0.55', () => {
    it('V = 0.55: not weak', () => {
      expect(weak({ judges: { keyword_top: 0, vector_top: 0.55 } })).toBe(
        false,
      );
    });
    it('V = 0.54: weak', () => {
      expect(weak({ judges: { keyword_top: 0, vector_top: 0.54 } })).toBe(true);
    });
  });

  describe('rule 7: judges known', () => {
    it('judges null (non-fused path): not weak', () => {
      expect(weak({ judges: null })).toBe(false);
    });
  });

  it('does not read other request fields (needs, passed_needs)', () => {
    const r: RulesRequest = req({ needs: ['N-FOD'], passed_needs: ['N-HOU'] });
    expect(weak({ req: r })).toBe(true);
  });
});
