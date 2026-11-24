import { contentWords } from '../../search/internal/text-matching/word-rarity';
import { decide, finalize, gridRule, weakMatchDecision } from './engine';
import { Match } from './match';
import { areasInPlay, hasEnoughOptions } from './questions';
import { localizeClarification } from './localize';
import { clearAreas, needLevel } from './need-level';
import { childrenOf } from './sune';
import { CUTOFFS, PHONE_LINE, RULES_VERSION, STEMS } from './config';
import { req, sig } from '../../common/testing/v2-rules-helpers';
import { FinalizeInput, GridRule, RulesRequest, RulesSignals } from './types';

/** The grid (question rule v1, flag V2_QUESTION_RULE_V1 on): one case per rule. */
const words = (q: string) => q.split(/\s+/).filter(Boolean);

interface Opts {
  match?: Match;
  weak?: boolean;
  total?: number | null;
  request?: Partial<RulesRequest>;
  signals?: RulesSignals;
}

function run(query: string, scores: Record<string, number>, o: Opts = {}) {
  const request = req({
    query,
    content_words: words(query),
    ...o.request,
  });
  const decision = decide(request, o.signals ?? sig(scores), {});
  const by_code: Record<string, number> = {};
  for (const c of decision.count_codes) by_code[c] = 10;
  const input: FinalizeInput = {
    counts: { total: o.total === undefined ? 100 : o.total, by_code },
    ...(o.match && { match: o.match }),
    ...(o.weak !== undefined && { weak: o.weak }),
  };
  const clar = finalize(decision, input);
  return {
    decision,
    clar,
    rule: gridRule(decision, input),
    ids: clar.questions.map((q) => q.id),
  };
}

const danger = (scores: Record<string, number>): RulesSignals =>
  sig(scores, { emergency: { status: 'ok', score: 0.9, floor_hit: false } });

describe('question rule v1: version and constants', () => {
  it('rules version is bumped', () => {
    expect(RULES_VERSION).toBe('rules-2026-11-24.1');
  });
  it('phone line and notice text', () => {
    expect(PHONE_LINE).toEqual({ label: 'Call 211', number: '211' });
    expect(STEMS.notice).toBe(
      'These results may not match what you typed. Pick what you need below, or try different words.',
    );
  });
});

describe('step 2: no results', () => {
  it('weak match: the no_match question and the phone line, no notice', () => {
    const request = req({ query: 'dkdjfjsjf', content_words: ['dkdjfjsjf'] });
    const d = decide(request, sig({}), {});
    const w = weakMatchDecision(d, request, {});
    const input: FinalizeInput = {
      counts: { total: 100, by_code: null }, // the text-free count call
      match: 'none',
      weak: true,
    };
    const clar = finalize(w, input);
    expect(gridRule(w, input)).toBe('no_results');
    expect(clar.questions.map((q) => q.id)).toEqual(['no_match']);
    expect(clar.phone_line).toEqual(PHONE_LINE);
    expect('notice' in clar).toBe(false);
  });
  it('total 0: no need question, the phone line, no notice', () => {
    const r = run('food', { 'N-FOD': 0.9 }, { total: 0, match: 'none' });
    expect(r.rule).toBe('no_results');
    expect(r.ids).toEqual([]);
    expect(r.clar.phone_line).toEqual(PHONE_LINE);
    expect('notice' in r.clar).toBe(false);
  });
  it('total 0 with an unclear need: no start either', () => {
    const r = run('seattle', {}, { total: 0 });
    expect(r.ids).toEqual([]);
    expect(r.clar.phone_line).toEqual(PHONE_LINE);
  });
  it('total null (not counted) is not no results', () => {
    const r = run('food', { 'N-FOD': 0.9 }, { total: null });
    expect(r.rule).toBe('R3');
  });
  it('emergency stays first', () => {
    const r = run('food', {}, { total: 0, signals: danger({}) });
    expect(r.ids).toEqual(['emergency']);
  });
});

describe('R1: the hits are concentrated', () => {
  it('a clear area but no need question', () => {
    const r = run('ymca', { 'N-HLT': 0.9 }, { match: 'concentrated' });
    expect(r.rule).toBe('R1');
    expect(r.ids).toEqual([]);
  });
  it('an unclear need: start is built but dropped', () => {
    const r = run('ymca', { 'N-HLT': 0.02 }, { match: 'concentrated' });
    expect(r.decision.candidates.map((q) => q.id)).toContain('start');
    expect(r.rule).toBe('R1');
    expect(r.ids).toEqual([]);
  });
  it('no phone line, no notice', () => {
    const r = run('ymca', {}, { match: 'concentrated' });
    expect('phone_line' in r.clar).toBe(false);
    expect('notice' in r.clar).toBe(false);
  });
  it('emergency stays first', () => {
    const r = run('ymca', {}, { match: 'concentrated', signals: danger({}) });
    expect(r.ids).toEqual(['emergency']);
  });
});

describe('R2: the kind is clear', () => {
  it('Tier 2 at 0.97: no need question', () => {
    const r = run('food pantry', { 'N-FOD': 0.6, 'N-FOD-01': 0.97 });
    expect(r.decision.need_level).toBe('kind');
    expect(r.rule).toBe('R2');
    expect(r.ids).toEqual([]);
  });
  it('Tier 2 at 0.969 is a likely kind (D1): R2, results, one quiet question', () => {
    const r = run('food pantry', { 'N-FOD': 0.6, 'N-FOD-01': 0.969 });
    expect(r.decision.need_level).toBe('likely');
    expect(r.decision.likely_areas).toEqual(['N-FOD']);
    expect(r.rule).toBe('R2');
    expect(r.ids).toEqual(['area:N-FOD']);
    expect(r.clar.questions[0].importance).toBe('medium');
  });
  it('a likely kind and match none (D1): neither area nor kind clear, R5 start', () => {
    const r = run('food pantry', { 'N-FOD-01': 0.9 }, { match: 'none' });
    expect(r.decision.need_level).toBe('likely'); // before the match is known
    expect(r.rule).toBe('R5');
    expect(r.ids).toEqual(['start']);
  });
  it('a likely kind in an area clear by its own Tier 1 score, match none: R3, high', () => {
    const r = run(
      'food pantry',
      { 'N-FOD': 0.9, 'N-FOD-01': 0.9 },
      { match: 'none' },
    );
    expect(r.rule).toBe('R3');
    expect(r.ids).toEqual(['area:N-FOD']);
    expect(r.clar.questions[0].importance).toBe('high');
  });
  it('a sure kind (0.97) stays clear on match none: R2, no question', () => {
    const r = run('food pantry', { 'N-FOD-01': 0.99 }, { match: 'none' });
    expect(r.rule).toBe('R2');
    expect(r.ids).toEqual([]);
  });
  it('off the default: match spread gives the same as no match (D1 changes only none)', () => {
    const a = run('food pantry', { 'N-FOD-01': 0.9 }, { match: 'spread' });
    expect(a.rule).toBe('R2');
    expect(a.ids).toEqual(['area:N-FOD']);
  });
  it('caller picked a Tier 2 need: R2', () => {
    const r = run('food', {}, { request: { needs: ['N-FOD-01'] } });
    expect(r.decision.need_level).toBe('kind');
    expect(r.rule).toBe('R2');
    expect(r.ids).toEqual([]);
  });
  it('caller picked N-X: R2', () => {
    const r = run('food', { 'N-FOD': 0.9 }, { request: { needs: ['N-X'] } });
    expect(r.rule).toBe('R2');
    expect(r.ids).toEqual([]);
  });
  it('every clear area has a clear kind: R2', () => {
    const r = run('x', {
      'N-FOD': 0.9,
      'N-FOD-01': 0.99,
      'N-HOU': 0.9,
      'N-HOU-02': 0.98,
    });
    expect(r.rule).toBe('R2');
  });
  it('emergency stays first', () => {
    const r = run(
      'food pantry',
      { 'N-FOD-01': 0.99 },
      {
        signals: danger({ 'N-FOD-01': 0.99 }),
      },
    );
    expect(r.ids).toEqual(['emergency']);
  });
});

describe('R3: an open area', () => {
  it('Tier 2 at 0.5 makes the kind clear (D1): R2 and a quiet question', () => {
    const r = run('food', { 'N-FOD-01': 0.5 });
    expect(r.decision.need_level).toBe('likely');
    expect(r.decision.open_areas).toEqual([]);
    expect(r.rule).toBe('R2');
    expect(r.ids).toEqual(['area:N-FOD']);
    expect(r.clar.questions[0].reason).toBe('area_only');
    expect(r.clar.questions[0].importance).toBe('medium');
  });
  it('D2: with two open areas the most uncertain stays high, the other is medium', () => {
    const r = run('housing food', {
      'N-HOU': 0.85,
      'N-FOD': 0.85,
      'N-FOD-01': 0.4,
    });
    expect(r.rule).toBe('R3');
    expect(r.decision.open_areas).toHaveLength(2);
    const imp = r.clar.questions
      .filter((q) => q.id.startsWith('area:'))
      .map((q) => q.importance);
    expect(imp.filter((i) => i === 'high')).toHaveLength(1);
    expect(imp.filter((i) => i === 'medium')).toHaveLength(1);
    expect(imp[0]).toBe('high');
  });
  it('D2: one open area stays high', () => {
    const r = run('food', { 'N-FOD': 0.85 });
    expect(r.clar.questions[0].importance).toBe('high');
  });
  it('Tier 2 at 0.49: the area is not clear (R4 start)', () => {
    const r = run('food', { 'N-FOD-01': 0.49 });
    expect(r.decision.need_level).toBe('unclear');
  });
  it('Tier 1 at 0.8 is clear; 0.79 is not', () => {
    expect(run('food', { 'N-FOD': 0.8 }).rule).toBe('R3');
    const low = run('food', { 'N-FOD': 0.79 });
    expect(low.decision.need_level).toBe('unclear');
    expect(low.rule).toBe('R4');
  });
  it('caller confirmed the area: area_confirmed', () => {
    const r = run('food', {}, { request: { needs: ['N-FOD'] } });
    expect(r.rule).toBe('R3');
    expect(r.ids).toEqual(['area:N-FOD']);
    expect(r.clar.questions[0].reason).toBe('area_confirmed');
  });
  it('a passed area is not clear', () => {
    const r = run(
      'food',
      { 'N-FOD': 0.9 },
      { request: { passed_needs: ['N-FOD'] } },
    );
    expect(r.decision.need_level).toBe('unclear');
  });
  it('R3 drops spread and start', () => {
    const r = run('testing', { 'N-HLT': 0.9, 'N-LRN': 0.3, 'N-SAF': 0.2 });
    expect(r.ids).toEqual(['area:N-HLT']);
  });
  it('every open area gets a question, the most uncertain first', () => {
    const flat = Object.fromEntries(childrenOf('N-FOD').map((c) => [c, 0.4]));
    const r = run('i need food and housing', {
      'N-HOU': 0.95,
      'N-HOU-01': 0.44,
      'N-FOD': 0.85,
      ...flat,
    });
    expect(r.decision.open_areas).toEqual(['N-HOU', 'N-FOD']);
    expect(r.rule).toBe('R3');
    // Food has the flatter scores (more entropy), so it comes first although
    // housing has the higher Tier 1 score.
    expect(r.ids).toEqual(['area:N-FOD', 'area:N-HOU']);
  });
  it('an open area and a kind-clear area: only the open area is asked', () => {
    const r = run('x', {
      'N-FOD': 0.9,
      'N-FOD-01': 0.99,
      'N-HOU': 0.9,
    });
    expect(r.decision.open_areas).toEqual(['N-HOU']);
    expect(r.ids).toEqual(['area:N-HOU']);
  });
  it('the area question is dropped when it has fewer than 2 options', () => {
    const r = run('disability', { 'N-DIS': 0.9 });
    expect(r.rule).toBe('R3');
    expect(r.ids).toEqual([]);
  });
  it('emergency stays first', () => {
    const r = run(
      'food',
      { 'N-FOD': 0.9 },
      { signals: danger({ 'N-FOD': 0.9 }) },
    );
    expect(r.ids).toEqual(['emergency', 'area:N-FOD']);
  });
});

describe('R4: no clear need, the hits are spread', () => {
  it('two areas in play: the spread question only', () => {
    const r = run('testing', { 'N-HLT': 0.3, 'N-LRN': 0.2 });
    expect(r.rule).toBe('R4');
    expect(r.ids).toEqual(['spread']);
    const q = r.clar.questions[0];
    expect(q.reason).toBe('several_areas');
    expect(q.step).toBe(2);
    expect(q.stem).toBe("Which kind of 'testing' do you mean?");
    expect(q.options.map((o) => o.value).sort()).toEqual(['N-HLT', 'N-LRN']);
    expect('notice' in r.clar).toBe(false);
    expect('phone_line' in r.clar).toBe(false);
  });
  it('one area in play: that area question only, reason area_only', () => {
    const r = run('testing', { 'N-HLT': 0.3, 'N-LRN': 0.04 });
    expect(r.rule).toBe('R4');
    expect(r.ids).toEqual(['area:N-HLT']);
    expect(r.clar.questions[0].reason).toBe('area_only');
  });
  it('no area in play: start only', () => {
    const r = run('seattle', { 'N-HOU': 0.03, 'N-FOD': 0.02 });
    expect(r.ids).toEqual(['start']);
  });
  it('3 content words: start only', () => {
    const r = run('free dental clinic', { 'N-HLT': 0.3, 'N-LRN': 0.2 });
    expect(r.decision.candidates.map((q) => q.id)).not.toContain('spread');
    expect(r.ids).toEqual(['start']);
  });
  it('the area question is not built (fewer than 2 options): start', () => {
    const kinds = childrenOf('N-HLT');
    const r = run(
      'testing',
      { 'N-HLT': 0.3 },
      { request: { passed_needs: kinds.slice(1) } },
    );
    expect(r.decision.candidates.map((q) => q.id)).not.toContain('area:N-HLT');
    expect(r.rule).toBe('R4');
    expect(r.ids).toEqual(['start']);
  });
  it('browse (no text): start', () => {
    const r = run(
      '',
      {},
      {
        request: { has_text: false, query: undefined, content_words: [] },
        signals: { needs: { status: 'ok', scores: {} }, emergency: null },
      },
    );
    expect(r.rule).toBe('R4');
    expect(r.ids).toEqual(['start']);
  });
  it('match absent behaves as spread', () => {
    expect(run('testing', { 'N-HLT': 0.3, 'N-LRN': 0.2 }).rule).toBe('R4');
  });
  it('the needs signal failed: R4, no need question', () => {
    const r = run(
      'testing',
      {},
      {
        signals: { needs: { status: 'error' }, emergency: null },
      },
    );
    expect(r.decision.need_level).toBe('unclear');
    expect(r.rule).toBe('R4');
    expect(r.ids).toEqual([]);
  });
  it('emergency stays first', () => {
    const r = run(
      'testing',
      {},
      {
        signals: danger({ 'N-HLT': 0.3, 'N-LRN': 0.2 }),
      },
    );
    expect(r.ids[0]).toBe('emergency');
  });
});

describe('R5: no clear need, the hits do not hold the words', () => {
  it('start only, with the notice and the phone line', () => {
    const r = run(
      'portico',
      { 'N-HLT': 0.29, 'N-SAF': 0.1 },
      { match: 'none' },
    );
    expect(r.decision.candidates.map((q) => q.id)).toContain('spread');
    expect(r.rule).toBe('R5');
    expect(r.ids).toEqual(['start']);
    expect(r.clar.notice).toEqual({
      kind: 'may_not_match',
      text: STEMS.notice,
    });
    expect(r.clar.phone_line).toEqual(PHONE_LINE);
  });
  it('a clear need is never R5', () => {
    const r = run('food', { 'N-FOD': 0.9 }, { match: 'none' });
    expect(r.rule).toBe('R3');
    expect('notice' in r.clar).toBe(false);
  });
  it('emergency stays first', () => {
    const r = run('portico', {}, { match: 'none', signals: danger({}) });
    expect(r.ids).toEqual(['emergency', 'start']);
  });
});

describe('gridRule', () => {
  const rule = (
    scores: Record<string, number>,
    input: Partial<FinalizeInput>,
  ): GridRule =>
    gridRule(decide(req({ content_words: ['x'] }), sig(scores), {}), {
      counts: { total: 10, by_code: null },
      ...input,
    });
  it('step 2 wins over match and need', () => {
    expect(rule({ 'N-FOD': 0.9 }, { weak: true, match: 'concentrated' })).toBe(
      'no_results',
    );
    expect(rule({}, { counts: { total: 0, by_code: null } })).toBe(
      'no_results',
    );
  });
  it('R1 wins over every need level', () => {
    for (const scores of [{}, { 'N-FOD': 0.9 }, { 'N-FOD-01': 0.99 }]) {
      expect(rule(scores, { match: 'concentrated' })).toBe('R1');
    }
  });
  it('maps need level and match to R2 to R5', () => {
    expect(rule({ 'N-FOD-01': 0.99 }, { match: 'none' })).toBe('R2');
    expect(rule({ 'N-FOD': 0.9 }, { match: 'none' })).toBe('R3');
    expect(rule({}, { match: 'spread' })).toBe('R4');
    expect(rule({}, {})).toBe('R4');
    expect(rule({}, { match: 'none' })).toBe('R5');
  });
});

describe('need level', () => {
  const r = (scores: Record<string, number>) => ({
    request: req(),
    signals: sig(scores),
  });
  it('clearAreas: best Tier 1 score first; a kind makes an area clear', () => {
    const { request, signals } = r({
      'N-HOU': 0.85,
      'N-FOD': 0.1,
      'N-FOD-01': 0.9,
      'N-MON': 0.3,
    });
    expect(clearAreas(request, signals)).toEqual([
      { code: 'N-FOD', kind_clear: true, likely_kind: true },
      { code: 'N-HOU', kind_clear: false, likely_kind: false },
    ]);
  });
  it('an area made clear by a kind sorts by the better score', () => {
    const { request, signals } = r({ 'N-HOU': 0.85, 'N-FOD-01': 0.99 });
    expect(clearAreas(request, signals).map((a) => a.code)).toEqual([
      'N-FOD',
      'N-HOU',
    ]);
    expect(clearAreas(request, signals)[0].kind_clear).toBe(true);
  });
  it('needs signal failed: [] and unclear', () => {
    const request = req({ needs: ['N-FOD'] });
    const signals: RulesSignals = {
      needs: { status: 'error' },
      emergency: null,
    };
    expect(clearAreas(request, signals)).toEqual([]);
    expect(needLevel(request, signals)).toBe('unclear');
  });
  it('levels', () => {
    const lv = (
      scores: Record<string, number>,
      o: Partial<RulesRequest> = {},
    ) => needLevel(req(o), sig(scores));
    expect(lv({})).toBe('unclear');
    expect(lv({ 'N-FOD': 0.8 })).toBe('area');
    expect(lv({ 'N-FOD-01': 0.97 })).toBe('kind');
    expect(lv({}, { needs: ['N-X'] })).toBe('kind');
    expect(lv({}, { needs: ['N-FOD-02'] })).toBe('kind');
  });
  it('a likely kind (Tier 2 below needs.use) gives level likely', () => {
    const lv = (scores: Record<string, number>) =>
      needLevel(req(), sig(scores));
    expect(lv({ 'N-FOD-01': 0.6 })).toBe('likely');
    // 0.46 is kind clear now (cutoff 0.45) when the area is clear by Tier 1.
    expect(lv({ 'N-FOD': 0.85, 'N-FOD-01': 0.46 })).toBe('likely');
    expect(lv({ 'N-FOD': 0.85, 'N-FOD-01': 0.44 })).toBe('area');
    expect(CUTOFFS.area.kindClearMin).toBe(0.45);
  });
  it('a likely kind gives the same questions as a clear kind (R2)', () => {
    const r = run('food', { 'N-FOD-01': 0.6 });
    expect(r.decision.need_level).toBe('likely');
    expect(r.rule).toBe('R2');
  });
});

describe('other', () => {
  it('clarify=never keeps only the emergency question', () => {
    const r = run(
      'testing',
      { 'N-HLT': 0.3, 'N-LRN': 0.2 },
      {
        request: { clarify: 'never' },
      },
    );
    expect(r.decision.candidates).toEqual([]);
    expect(r.ids).toEqual([]);
  });

  it('spread uses the content-word limit and the area floor', () => {
    expect(CUTOFFS.spread).toEqual({ areaInPlayMin: 0.05, maxContentWords: 2 });
    expect(STEMS.spread).toContain('{word}');
    const one = run('testing', { 'N-HLT': 0.3, 'N-LRN': 0.04 });
    expect(one.decision.candidates.map((q) => q.id)).not.toContain('spread');
    const three = run('a b c', { 'N-HLT': 0.3, 'N-LRN': 0.2 });
    expect(three.decision.candidates.map((q) => q.id)).not.toContain('spread');
  });

  it('areasInPlay: best first, leaves out confirmed and passed codes; [] when the needs signal failed', () => {
    const r = req({ passed_needs: ['N-SAF'] });
    expect(
      areasInPlay(r, sig({ 'N-HLT': 0.2, 'N-LRN': 0.3, 'N-SAF': 0.5 })),
    ).toEqual(['N-LRN', 'N-HLT']);
    expect(
      areasInPlay(r, { needs: { status: 'error' }, emergency: null }),
    ).toEqual([]);
  });
});

describe('hasEnoughOptions (open point 4.10 Q2, David 2026-11-23: yes)', () => {
  const opts = [
    { results_count: 5 },
    { results_count: 0 },
    { results_count: 0 },
  ];
  it('one option with services next to 0-count options is a choice; one option is not', () => {
    expect(hasEnoughOptions(opts)).toBe(true);
    expect(hasEnoughOptions([{ results_count: 5 }])).toBe(false);
  });
});

describe('R5 without a question to pick from', () => {
  const clarificationOf = (over: {
    req?: Parameters<typeof req>[0];
    tenant?: Parameters<typeof decide>[2];
    failed?: boolean;
  }) => {
    const signals = over.failed
      ? { needs: { status: 'error' as const }, emergency: null }
      : sig({});
    const d = decide(
      req({ query: 'zebra', content_words: ['zebra'], ...over.req }),
      signals,
      over.tenant ?? {},
    );
    return finalize(d, {
      counts: { total: 40, by_code: null },
      match: 'none',
      weak: false,
    });
  };
  it('a start question is there: notice and phone line', () => {
    const c = clarificationOf({});
    expect(c.questions.map((q) => q.id)).toEqual(['start']);
    expect(c.notice?.kind).toBe('may_not_match');
    expect(c.phone_line).toBeDefined();
  });
  it.each([
    ['clarify=never', { req: { clarify: 'never' as const } }],
    ['AI off', { tenant: { ai_classification: 'off' as const } }],
    ['needs call failed', { failed: true }],
  ])('%s: no question, so no notice and no phone line', (_n, over) => {
    const c = clarificationOf(over);
    expect(c.questions).toEqual([]);
    expect(c.notice).toBeUndefined();
    expect(c.phone_line).toBeUndefined();
  });
});

describe('spread: stem word and word limit (topic words, not content words)', () => {
  const two = { 'N-HLT': 0.3, 'N-LRN': 0.2 };
  const ask = (q: string, lang = 'en') =>
    run(q, two, {
      request: { query: q, content_words: contentWords(q, lang) },
    });

  it("'i need food' asks the spread question about 'food'", () => {
    const r = ask('i need food');
    expect(r.ids).toEqual(['spread']);
    expect(r.clar.questions[0].stem).toBe("Which kind of 'food' do you mean?");
  });
  it("'food please help' has 1 topic word: now gets a spread question", () => {
    const r = ask('food please help');
    expect(r.ids).toEqual(['spread']);
    expect(r.clar.questions[0].stem).toBe("Which kind of 'food' do you mean?");
  });
  it("'Comida y renta' keeps the joining word between two topics", () => {
    const r = ask('Comida y renta', 'es');
    expect(r.clar.questions[0].stem).toBe(
      "Which kind of 'Comida y renta' do you mean?",
    );
  });
  it("es 'necesito comida': the localized stem names 'comida'", () => {
    const r = ask('necesito comida', 'es');
    const es = localizeClarification(r.clar, 'es');
    expect(es.questions[0].stem).toBe("¿Qué tipo de 'comida' quiere decir?");
  });
  it("en 'ayuda con renta': the stem names 'renta'", () => {
    const r = ask('ayuda con renta');
    expect(r.clar.questions[0].stem).toBe("Which kind of 'renta' do you mean?");
  });
  it('request words only: no spread, no in-play area question; the start question', () => {
    const r = ask('help please');
    expect(r.decision.candidates.map((q) => q.id)).not.toContain('spread');
    expect(r.ids).toEqual(['start']);
  });
  it('three topic words: no spread', () => {
    const r = ask('food housing clothes');
    expect(r.decision.candidates.map((q) => q.id)).not.toContain('spread');
  });
});
