import { decide, finalize } from './engine';
import { req, sig } from '../../common/testing/v2-rules-helpers';

const ids = (d: ReturnType<typeof decide>) => d.candidates.map((q) => q.id);
const opts = (d: ReturnType<typeof decide>, id: string) =>
  d.candidates.find((q) => q.id === id).options.map((o) => o.value);

describe('emergency question', () => {
  const popup = { status: 'ok' as const, score: 0.9, floor_hit: false };
  const soft = { status: 'ok' as const, score: 0.3, floor_hit: false };
  const emergencyOf = (d: ReturnType<typeof decide>) =>
    d.candidates.find((q) => q.id === 'emergency');
  it('popup: first, level red, urgency options only (no U-0), carries hotlines (Decision 54)', () => {
    const d = decide(req(), sig({}, { emergency: popup }));
    const q = d.candidates[0];
    expect(q.id).toBe('emergency');
    expect(q.level).toBe('red');
    expect(q.step).toBe(0);
    expect(q.options).toEqual([
      { label: 'Today', parameter: 'urgency', value: 'U-1' },
      { label: 'Not urgent', parameter: 'urgency', value: 'U-3' },
    ]);
    expect(q.hotlines).toEqual([
      { label: 'Crisis line', number: '988' },
      { label: 'Emergency', number: '911' },
    ]);
    expect(q.multi_select || q.allow_other || q.none_of_these).toBe(false);
  });
  it('soft band: level orange, same urgency options (Decision 54)', () => {
    const d = decide(req(), sig({}, { emergency: soft }));
    expect(d.emergency_band).toBe('soft');
    const q = emergencyOf(d);
    expect(q.level).toBe('orange');
    expect(q.options.map((o) => o.value)).toEqual(['U-1', 'U-3']);
    expect(q.hotlines).toHaveLength(2);
  });
  it('no option anywhere offers U-0 (Decision 54)', () => {
    for (const e of [popup, soft]) {
      const d = decide(req(), sig({}, { emergency: e }));
      const all = d.candidates.flatMap((q) => q.options.map((o) => o.value));
      expect(all).not.toContain('U-0');
    }
  });
  it('the question has no parameter field; each option carries one (Decision 55)', () => {
    const d = decide(req(), sig({}, { emergency: popup }));
    for (const q of d.candidates) {
      expect(q).not.toHaveProperty('parameter');
      for (const o of q.options) {
        expect(['needs', 'passed_needs', 'urgency']).toContain(o.parameter);
      }
    }
  });
  it('the decision has no show_hotline; the band stays internal', () => {
    const d = decide(req(), sig({}, { emergency: popup }));
    expect(d).not.toHaveProperty('emergency');
    expect(d.emergency_band).toBe('popup');
  });
  it('uses tenant hotlines', () => {
    const d = decide(req(), sig({}, { emergency: popup }), {
      hotlines: [{ label: 'X', number: '1' }],
    });
    expect(d.candidates[0].hotlines).toEqual([{ label: 'X', number: '1' }]);
  });
  it('an empty tenant hotline list falls back to the defaults', () => {
    const d = decide(req(), sig({}, { emergency: popup }), { hotlines: [] });
    expect(d.candidates[0].hotlines).toEqual([
      { label: 'Crisis line', number: '988' },
      { label: 'Emergency', number: '911' },
    ]);
  });
  it.each(['U-1', 'U-2', 'U-3', 'U-4'] as const)(
    'popup + caller urgency %s -> no emergency question (Decision 51)',
    (u) => {
      const d = decide(req({ urgency: u }), sig({}, { emergency: popup }));
      expect(ids(d)).not.toContain('emergency');
    },
  );
  it('soft + caller urgency U-3 -> no emergency question', () => {
    const d = decide(req({ urgency: 'U-3' }), sig({}, { emergency: soft }));
    expect(ids(d)).not.toContain('emergency');
  });
  it('popup + urgency U-X counts as no answer -> emergency question stays', () => {
    const d = decide(req({ urgency: 'U-X' }), sig({}, { emergency: popup }));
    expect(emergencyOf(d).level).toBe('red');
  });
  describe('caller urgency=U-0 (Decision 50, unconfirmed reading)', () => {
    const expectU0Popup = (d: ReturnType<typeof decide>) => {
      const q = d.candidates[0];
      expect(q.id).toBe('emergency');
      expect(q.type).toBe('emergency');
      expect(q.level).toBe('red');
      expect(q.importance).toBe('critical');
      expect(q.options).toEqual([]);
      expect(q.hotlines).toEqual([
        { label: 'Crisis line', number: '988' },
        { label: 'Emergency', number: '911' },
      ]);
    };
    it('no text (check did not run) -> popup with hotlines, no options', () => {
      expectU0Popup(
        decide(req({ urgency: 'U-0' }), sig({}, { emergency: null })),
      );
    });
    it('band none -> popup with hotlines, no options', () => {
      expectU0Popup(decide(req({ urgency: 'U-0' }), sig()));
    });
    it('band soft -> still the popup (red), no options', () => {
      expectU0Popup(
        decide(req({ urgency: 'U-0' }), sig({}, { emergency: soft })),
      );
    });
    it('band popup -> popup, no options', () => {
      expectU0Popup(
        decide(req({ urgency: 'U-0' }), sig({}, { emergency: popup })),
      );
    });
    it('band unknown -> popup, no options', () => {
      expectU0Popup(
        decide(
          req({ urgency: 'U-0' }),
          sig({}, { emergency: { status: 'error' } }),
        ),
      );
    });
    it('clarify=never keeps it', () => {
      expectU0Popup(decide(req({ urgency: 'U-0', clarify: 'never' }), sig()));
    });
    it('finalize keeps it with no options and any counts', () => {
      const d = decide(req({ urgency: 'U-0' }), sig());
      const c = finalize(d, {
        counts: { total: 0, by_code: {} },
        strong_text_match: true,
      });
      expect(c.questions[0].id).toBe('emergency');
      expect(c.questions[0].options).toEqual([]);
    });
    it('not cacheable (Decision 28: the response holds an emergency question)', () => {
      expect(decide(req({ urgency: 'U-0' }), sig()).cacheable).toBe(false);
    });
  });
  it('clarify=never keeps the emergency question, drops the rest (Decision 26)', () => {
    const d = decide(
      req({ clarify: 'never' }),
      sig({ 'N-HOU': 0.5 }, { emergency: soft }),
    );
    expect(ids(d)).toEqual(['emergency']);
    expect(d.candidates[0].level).toBe('orange');
  });
  it('cacheable only for none band, no emergency question and ok needs', () => {
    expect(decide(req(), sig()).cacheable).toBe(true);
    expect(decide(req(), sig({}, { emergency: null })).cacheable).toBe(true);
    expect(decide(req(), sig({}, { emergency: popup })).cacheable).toBe(false);
    expect(decide(req(), sig({}, { emergency: soft })).cacheable).toBe(false);
    expect(
      decide(req(), sig({}, { emergency: { status: 'error' } })).cacheable,
    ).toBe(false);
    expect(
      decide(req(), { needs: { status: 'error' }, emergency: null }).cacheable,
    ).toBe(false);
  });
});

describe('option shape (Decision 55)', () => {
  it('need options are {label, parameter: needs, value}', () => {
    const d = decide(req(), sig({ 'N-HOU': 0.95 }));
    const q = d.candidates.find((c) => c.type === 'find_need');
    expect(q).toBeDefined();
    for (const o of q.options) {
      expect(Object.keys(o)).toEqual(['label', 'parameter', 'value']);
      expect(o.parameter).toBe('needs');
    }
  });
  it('urgency options are {label, parameter: urgency, value}', () => {
    const d = decide(req(), {
      needs: { status: 'ok', scores: {} },
      urgency: { level: 'U-1', score: 0.85 },
      emergency: { status: 'ok', score: 0.001 },
    });
    const q = d.candidates.find((c) => c.id === 'urgency_today');
    expect(q.options[0]).toEqual({
      label: 'Today',
      parameter: 'urgency',
      value: 'U-1',
    });
  });
});

describe('time questions', () => {
  const askU = (level: 'U-1' | 'U-2') => ({
    needs: {
      status: 'ok' as const,
      scores: {},
    },
    urgency: { level, score: 0.85 },
    emergency: { status: 'ok' as const, score: 0.001 },
  });
  it('today question for level U-1', () => {
    const d = decide(req(), askU('U-1'));
    const q = d.candidates.find((c) => c.id === 'urgency_today');
    expect(q.step).toBe(1);
    expect(q.options.map((o) => o.value)).toEqual(['U-1', 'U-2', 'U-3']);
  });
  it('time question for other level', () => {
    const q = decide(req(), askU('U-2')).candidates.find(
      (c) => c.id === 'urgency_time',
    );
    expect(q.step).toBe(5);
    expect(q.options.map((o) => o.value)).toEqual(['U-1', 'U-2', 'U-4', 'U-3']);
  });
  it('caller urgency=U-X counts as absent: question still shows (ISS-2499)', () => {
    const d = decide(req({ urgency: 'U-X' }), askU('U-1'));
    expect(d.urgency).toEqual({
      value: 'U-X',
      source: 'default',
      state: 'ask',
    });
    expect(ids(d)).toContain('urgency_today');
  });
  it('caller urgency=U-X counts as absent: model guess is used (ISS-2499)', () => {
    const s = askU('U-2');
    s.urgency.score = 0.95;
    expect(decide(req({ urgency: 'U-X' }), s).urgency).toEqual({
      value: 'U-2',
      source: 'inferred',
      state: 'use',
    });
  });
  it('caller urgency=U-X does not hide the emergency question (ISS-2499)', () => {
    const s = askU('U-1');
    s.emergency = { status: 'ok', score: 0.9 };
    expect(ids(decide(req({ urgency: 'U-X' }), s))).toContain('emergency');
  });
  it('suppressed when emergency question exists', () => {
    const s = askU('U-1');
    s.emergency = { status: 'ok', score: 0.9 };
    expect(ids(decide(req(), s))).toEqual(['emergency', 'start']);
  });
});

describe('start question', () => {
  it('tiny scores -> tenant top_areas', () => {
    const d = decide(req(), sig({ 'N-FOD': 0.01 }), {
      top_areas: ['N-LEG', 'N-WRK', 'N-LRN', 'N-HOU'],
    });
    expect(opts(d, 'start')).toEqual(['N-LEG', 'N-WRK', 'N-LRN']);
  });
  it('tenant top_areas filled with defaults', () => {
    const d = decide(req(), sig(), { top_areas: ['N-LEG', 'bogus'] });
    expect(opts(d, 'start')).toEqual(['N-LEG', 'N-HOU', 'N-FOD']);
  });
  it('best T1 0.35 -> model areas', () => {
    const d = decide(
      req(),
      sig({ 'N-LEG': 0.35, 'N-WRK': 0.2, 'N-LRN': 0.1, 'N-HOU': 0.05 }),
    );
    expect(opts(d, 'start')).toEqual(['N-LEG', 'N-WRK', 'N-LRN']);
  });
  it('N-X is never an option on start, at any score (ISS-2499)', () => {
    for (const x of [0.06, 0.07, 0.9]) {
      expect(opts(decide(req(), sig({ 'N-X': x })), 'start')).not.toContain(
        'N-X',
      );
    }
  });
  it('passed Tier 1 never offered', () => {
    const d = decide(req({ passed_needs: ['N-HOU'] }), sig());
    expect(opts(d, 'start')).toEqual(['N-FOD', 'N-MON']);
  });
  it('not built when every area is passed (no zero-option question)', () => {
    const d = decide(req({ passed_needs: ['N-HOU', 'N-FOD', 'N-MON'] }), sig());
    expect(ids(d)).not.toContain('start');
  });
  it('not built when text has an inferred ask', () => {
    expect(ids(decide(req(), sig({ 'N-FOD-01': 0.5 })))).toEqual(['narrow:1']);
  });
});

describe('area questions', () => {
  it('confirmed Tier 1 -> area:N-HOU, no start', () => {
    const d = decide(
      req({ needs: ['N-HOU'] }),
      sig({
        'N-HOU-01': 0.11,
        'N-HOU-02': 0.1,
        'N-HOU-03': 0.09,
        'N-HOU-04': 0.05,
      }),
    );
    expect(ids(d)).toEqual(['area:N-HOU']);
    expect(opts(d, 'area:N-HOU')).toEqual(['N-HOU-01', 'N-HOU-02', 'N-HOU-03']);
    expect(d.candidates[0].reason).toBe('area_confirmed');
    expect(d.candidates[0].stem).toBe('Which kind of help with Housing?');
  });
  it('confirmed Tier 1 + unsure needs in that area: narrow offers no option of that area', () => {
    // Regression: needs=N-HOU with N-HOU-02 in the ask band gave area:N-HOU
    // and narrow:1 with the same housing options.
    const d = decide(
      req({ needs: ['N-HOU'] }),
      sig({ 'N-HOU-02': 0.6, 'N-HOU-01': 0.3, 'N-FOD-01': 0.4 }),
    );
    expect(ids(d)).toEqual(['area:N-HOU', 'narrow:1']);
    expect(opts(d, 'narrow:1')).toEqual(['N-FOD-01']);
  });
  it('confirmed Tier 1 + unsure needs only in that area: no narrow question', () => {
    const d = decide(
      req({ needs: ['N-HOU'] }),
      sig({ 'N-HOU-02': 0.6, 'N-HOU-01': 0.3 }),
    );
    expect(ids(d)).toEqual(['area:N-HOU']);
  });
  it('confirmed N-HOU-02 locks housing', () => {
    const d = decide(
      req({ needs: ['N-HOU-02'] }),
      sig({ 'N-HOU-01': 0.5, 'N-HOU-03': 0.5, 'N-FOD-01': 0.4 }),
    );
    const all = d.candidates.flatMap((q) => q.options.map((o) => o.value));
    expect(all.filter((c) => c.startsWith('N-HOU'))).toEqual([]);
    expect(all).toContain('N-FOD-01');
  });
  it('confirmed Tier 1 plus confirmed child -> no area question', () => {
    const d = decide(req({ needs: ['N-HOU', 'N-HOU-02'] }), sig());
    expect(ids(d)).toEqual([]);
  });
  it('confirmed N-X -> no needs questions', () => {
    expect(
      ids(decide(req({ needs: ['N-X'] }), sig({ 'N-FOD-01': 0.5 }))),
    ).toEqual([]);
  });
  it('needs status error -> no needs questions', () => {
    expect(
      ids(
        decide(req({ needs: ['N-HOU'] }), {
          needs: { status: 'error' },
          emergency: null,
        }),
      ),
    ).toEqual([]);
  });
  it('area rule fires and skips start/narrow', () => {
    const d = decide(
      req(),
      sig({ 'N-MHS': 0.98, 'N-MHS-01': 0.38, 'N-FOD-01': 0.3 }),
    );
    expect(ids(d)).toEqual(['area:N-MHS']);
    expect(d.candidates[0].reason).toBe('area_only');
  });
});

describe('narrow', () => {
  const five = {
    'N-FOD-01': 0.9,
    'N-FOD-02': 0.8,
    'N-HOU-01': 0.7,
    'N-MON-01': 0.6,
    'N-LEG-01': 0.5,
  };
  it('5 ask needs -> narrow:1 (3) and narrow:2 (2)', () => {
    const d = decide(req(), sig(five));
    expect(opts(d, 'narrow:1')).toEqual(['N-FOD-01', 'N-FOD-02', 'N-HOU-01']);
    expect(opts(d, 'narrow:2')).toEqual(['N-MON-01', 'N-LEG-01']);
    expect(d.candidates.map((q) => q.step)).toEqual([4, 6]);
    expect(d.count_codes).toEqual([...Object.keys(five)].sort());
  });
  it('passed codes never appear', () => {
    const d = decide(req({ passed_needs: ['N-FOD-01'] }), sig(five));
    const all = d.candidates.flatMap((q) => q.options.map((o) => o.value));
    expect(all).not.toContain('N-FOD-01');
  });
  it('N-X is never an option on narrow:1 (ISS-2499)', () => {
    expect(
      opts(decide(req(), sig({ ...five, 'N-X': 0.2 })), 'narrow:1'),
    ).not.toContain('N-X');
  });
  describe('a Tier 2 need is already used (ISS-2697)', () => {
    const used = { 'N-HOU-01': 0.999, 'N-HOU': 0.999 };
    it('used inferred Tier 2 + ask need elsewhere: narrow:1 goes to step 7', () => {
      const d = decide(req(), sig({ ...used, 'N-SAF-01': 0.24 }));
      expect(opts(d, 'narrow:1')).toEqual(['N-SAF-01']);
      expect(d.candidates.find((q) => q.id === 'narrow:1').step).toBe(7);
    });
    it("uses the 'also' stem; without a sure need the plain stem stays", () => {
      const d = decide(req(), sig({ ...used, 'N-SAF-01': 0.24 }));
      expect(d.candidates.find((q) => q.id === 'narrow:1').stem).toBe(
        'Do any of these also fit?',
      );
      const d2 = decide(req(), sig({ 'N-FOD-01': 0.5 }));
      expect(d2.candidates.find((q) => q.id === 'narrow:1').stem).toBe(
        'Which of these fits best?',
      );
    });
    it('a lone late narrow is still shown, importance low, also stem', () => {
      const d = decide(req(), sig({ ...used, 'N-SAF-01': 0.24 }));
      const r = finalize(d, {
        counts: { total: 100, by_code: null },
        strong_text_match: false,
      });
      expect(r.questions.map((q) => q.id)).toEqual(['narrow:1']);
      expect(r.questions[0].importance).toBe('low');
      expect(r.questions[0].stem).toBe('Do any of these also fit?');
    });
    it('no sure need: narrow:1 importance medium', () => {
      const d = decide(req(), sig({ 'N-FOD-01': 0.5 }));
      expect(d.candidates.find((q) => q.id === 'narrow:1').importance).toBe(
        'medium',
      );
    });
    it('urgency_time ranks below narrow:1 after finalize (higher value)', () => {
      const scores = { ...used, 'N-SAF-01': 0.24 };
      const d = decide(
        req(),
        sig(scores, {
          needs: {
            status: 'ok',
            scores,
          },
          urgency: { level: 'U-2', score: 0.85 },
        }),
      );
      const r = finalize(d, {
        counts: { total: 100, by_code: null },
        strong_text_match: false,
      });
      const order = r.questions.map((q) => q.id);
      expect(order).toContain('urgency_time');
      expect(order.indexOf('narrow:1')).toBeLessThan(
        order.indexOf('urgency_time'),
      );
    });
    it('no used Tier 2 need: narrow:1 stays at step 4', () => {
      const d = decide(req(), sig({ 'N-FOD-01': 0.5 }));
      expect(d.candidates.find((q) => q.id === 'narrow:1').step).toBe(4);
    });
    it('caller-confirmed Tier 2 + ask need elsewhere: narrow:1 at step 7', () => {
      const d = decide(req({ needs: ['N-HOU-01'] }), sig({ 'N-SAF-01': 0.24 }));
      expect(d.candidates.find((q) => q.id === 'narrow:1').step).toBe(7);
    });
  });
  it('count_codes excludes N-X', () => {
    expect(decide(req(), sig({ 'N-X': 0.3 })).count_codes).toEqual([
      'N-FOD',
      'N-HOU',
      'N-MON',
    ]);
  });
});

describe('clarify=never', () => {
  it('keeps only the emergency question', () => {
    const d = decide(
      req({ clarify: 'never' }),
      sig({ 'N-FOD-01': 0.5 }, { emergency: { status: 'ok', score: 0.9 } }),
    );
    expect(ids(d)).toEqual(['emergency']);
    expect(ids(decide(req({ clarify: 'never' }), sig()))).toEqual([]);
  });
});

describe('importance per question type', () => {
  const imp = (d: ReturnType<typeof decide>, id: string) =>
    d.candidates.find((c) => c.id === id)?.importance;
  const askU = (level: 'U-1' | 'U-2') => ({
    needs: {
      status: 'ok' as const,
      scores: {
        'N-FOD-01': 0.5,
        'N-FOD-02': 0.4,
        'N-HOU-01': 0.3,
        'N-MON-01': 0.2,
      },
    },
    urgency: { level, score: 0.85 },
    emergency: { status: 'ok' as const, score: 0.001 },
  });
  it('emergency is critical', () => {
    const d = decide(
      req(),
      sig({}, { emergency: { status: 'ok', score: 0.9, floor_hit: false } }),
    );
    expect(imp(d, 'emergency')).toBe('critical');
  });
  it('urgency_today and start are high', () => {
    expect(imp(decide(req(), askU('U-1')), 'urgency_today')).toBe('high');
    expect(imp(decide(req(), sig({})), 'start')).toBe('high');
  });
  it('area questions are high, both reasons', () => {
    const withNeeds = decide(
      req({ needs: ['N-HOU'] }),
      sig({ 'N-HOU-01': 0.11, 'N-HOU-02': 0.1, 'N-HOU-03': 0.09 }),
    );
    expect(imp(withNeeds, 'area:N-HOU')).toBe('high');
    const rule = decide(req(), sig({ 'N-MHS': 0.98, 'N-MHS-01': 0.38 }));
    expect(imp(rule, 'area:N-MHS')).toBe('high');
  });
  it('urgency_time, narrow:2 and a late narrow:1 are low; narrow:1 is medium', () => {
    expect(imp(decide(req(), askU('U-2')), 'urgency_time')).toBe('low');
    const d = decide(req(), askU('U-2'));
    expect(imp(d, 'narrow:1')).toBe('medium');
    expect(imp(d, 'narrow:2')).toBe('low');
    const late = decide(
      req({ needs: ['N-HOU-01'] }),
      sig({ 'N-SAF-01': 0.24 }),
    );
    expect(imp(late, 'narrow:1')).toBe('low');
  });
});
