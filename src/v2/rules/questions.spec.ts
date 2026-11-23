import { decide, finalize, weakMatchDecision } from './engine';
import { noMatchQuestion } from './questions';
import { TIER1_CODES } from './sune';
import { req, sig } from '../../common/testing/v2-rules-helpers';

const ids = (d: ReturnType<typeof decide>) => d.candidates.map((q) => q.id);
const opts = (d: ReturnType<typeof decide>, id: string) =>
  d.candidates.find((q) => q.id === id).options.map((o) => o.value);

describe('emergency question', () => {
  const popup = { status: 'ok' as const, score: 0.9, floor_hit: false };
  const soft = { status: 'ok' as const, score: 0.3, floor_hit: false };
  const emergencyOf = (d: ReturnType<typeof decide>) =>
    d.candidates.find((q) => q.id === 'emergency');
  it('popup: first, 3 options write U-0 / U-1 / U-2, carries hotlines (Lucas 2026-11-17)', () => {
    const d = decide(req(), sig({}, { emergency: popup }));
    const q = d.candidates[0];
    expect(q.id).toBe('emergency');
    expect(q.step).toBe(0);
    // Lucas 2026-11-13 (question 24, option B2): danger answers, same codes.
    expect(q.options).toEqual([
      {
        label: "Yes, I'm in danger right now",
        parameter: 'urgency',
        value: 'U-0',
      },
      {
        label: "No, I'm safe, but I need help today",
        parameter: 'urgency',
        value: 'U-1',
      },
      {
        label: "No, I'm safe, I need help soon (within a week)",
        parameter: 'urgency',
        value: 'U-2',
      },
    ]);
    expect(q.stem).toBe('Are you in danger right now?');
    expect(q.hotlines).toEqual([
      { label: 'Crisis line', number: '988' },
      { label: 'Emergency', number: '911' },
    ]);
    expect(q.multi_select || q.allow_other || q.none_of_these).toBe(false);
  });
  it('strong band importance critical (popup), soft band high (card) (Lucas 2026-11-13)', () => {
    expect(
      emergencyOf(decide(req(), sig({}, { emergency: popup }))).importance,
    ).toBe('critical');
    expect(
      emergencyOf(decide(req(), sig({}, { emergency: soft }))).importance,
    ).toBe('high');
    // A keyword-floor hit below the strong cutoff is the soft band.
    const floor = { status: 'ok' as const, score: 0.1, floor_hit: true };
    expect(
      emergencyOf(decide(req(), sig({}, { emergency: floor }))).importance,
    ).toBe('high');
  });
  it('caller U-0 hotline question stays critical in the soft band', () => {
    const d = decide(req({ urgency: 'U-0' }), sig({}, { emergency: soft }));
    expect(d.candidates[0].importance).toBe('critical');
  });
  it('soft band: the emergency question stays first even when a high question has a larger priority', () => {
    // Soft score 0.5 gives uncertainty 1 -> value 1 is capped; use 0.25 so the
    // emergency value is low and needs questions (high, value near 0.95) outrank it by number.
    const d = decide(
      req({ needs: ['N-HOU'] }),
      sig(
        {
          'N-HOU-01': 0.2,
          'N-HOU-02': 0.2,
          'N-HOU-03': 0.2,
          'N-HOU-04': 0.2,
          'N-HOU-05': 0.2,
        },
        { emergency: { status: 'ok', score: 0.222, floor_hit: false } },
      ),
    );
    const c = finalize(d, {
      counts: { total: 10, by_code: null },
      strong_text_match: false,
    });
    const em = c.questions.find((q) => q.id === 'emergency');
    expect(em.importance).toBe('high');
    expect(
      c.questions.some((q) => q.id !== 'emergency' && q.priority > em.priority),
    ).toBe(true);
    expect(c.questions[0].id).toBe('emergency');
  });
  it('soft band: same options', () => {
    const d = decide(req(), sig({}, { emergency: soft }));
    expect(d.emergency_band).toBe('soft');
    const q = emergencyOf(d);
    expect(q.options.map((o) => o.value)).toEqual(['U-0', 'U-1', 'U-2']);
    expect(q.hotlines).toHaveLength(2);
  });
  it('soft band uses the same danger labels and stem as the popup (question 24, B2)', () => {
    const red = emergencyOf(decide(req(), sig({}, { emergency: popup })));
    const orange = emergencyOf(decide(req(), sig({}, { emergency: soft })));
    expect(orange.stem).toBe(red.stem);
    expect(orange.options).toEqual(red.options);
    expect(orange.options.map((o) => o.label)).toEqual([
      "Yes, I'm in danger right now",
      "No, I'm safe, but I need help today",
      "No, I'm safe, I need help soon (within a week)",
    ]);
  });
  it('time questions keep the time labels (only the emergency question changes)', () => {
    const d = decide(req(), {
      needs: { status: 'ok', scores: {} },
      urgency: { level: 'U-1', score: 0.85 },
      emergency: { status: 'ok', score: 0.001 },
    });
    const q = d.candidates.find((c) => c.id === 'urgency_today');
    expect(q.options.map((o) => o.label)).toEqual([
      'Today',
      'A deadline is coming',
      'Not urgent',
    ]);
  });
  it('only the emergency question offers U-0 (Lucas 2026-11-13: "in danger -> u0")', () => {
    for (const e of [popup, soft]) {
      const d = decide(req(), sig({}, { emergency: e }));
      const withU0 = d.candidates.filter((q) =>
        q.options.some((o) => o.value === 'U-0'),
      );
      expect(withU0.map((q) => q.id)).toEqual(['emergency']);
    }
  });
  it("beside the emergency question: needs questions yes, urgency question no (today's rule)", () => {
    // Reported to Lucas, not changed: the time questions need !hasEmergency,
    // so after a "No" tap the page has the needs questions, never an urgency one.
    const d = decide(req(), {
      needs: { status: 'ok', scores: {} },
      urgency: { level: 'U-1', score: 0.85 },
      emergency: popup,
    });
    const c = finalize(d, {
      counts: { total: 10, by_code: null },
      strong_text_match: false,
    });
    expect(c.questions.map((q) => q.id)).toEqual(['emergency', 'start']);
    expect(d.urgency.state).toBe('ask');
  });
  it('"Yes" then: the next call with urgency=U-0 ends the flow (hotlines, no options, Decision 50)', () => {
    const first = decide(req(), sig({}, { emergency: popup }));
    const yes = first.candidates[0].options[0];
    expect([yes.parameter, yes.value]).toEqual(['urgency', 'U-0']);
    const next = decide(req({ urgency: 'U-0' }), sig({}, { emergency: popup }));
    expect(next.candidates[0].options).toEqual([]);
    expect(next.candidates[0].hotlines).toHaveLength(2);
    expect(next.urgency).toEqual({
      value: 'U-0',
      source: 'caller',
      state: 'use',
    });
    expect(next.candidates.some((q) => q.type === 'confirm_urgency')).toBe(
      false,
    );
  });
  it('the question has no parameter field; each option carries one (Decision 55)', () => {
    const d = decide(req(), sig({}, { emergency: popup }));
    for (const q of d.candidates) {
      expect(q).not.toHaveProperty('parameter');
      for (const o of q.options) {
        expect(['needs', 'passed_needs', 'urgency', null]).toContain(
          o.parameter,
        );
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
  it.each([
    ['popup', popup],
    ['soft', soft],
  ] as const)(
    '%s + urgency U-X (time not known) -> emergency question present',
    (_n, e) => {
      const d = decide(req({ urgency: 'U-X' }), sig({}, { emergency: e }));
      expect(ids(d)).toContain('emergency');
    },
  );
  it('picking "safe today" puts U-1 in the URL; the next call has no emergency card and no time question', () => {
    const first = decide(req(), sig({}, { emergency: popup }));
    const safe = first.candidates[0].options[1];
    expect([safe.parameter, safe.value]).toEqual(['urgency', 'U-1']);
    const next = decide(
      req({ urgency: safe.value as 'U-1' }),
      sig({}, { emergency: popup }),
    );
    expect(ids(next)).not.toContain('emergency');
    expect(ids(next)).not.toContain('urgency_today');
  });
  describe('keyword floor hit (Lucas 2026-11-17 final: caller urgency U-1..U-4 hides the card)', () => {
    const floor = { status: 'ok' as const, score: 0.1, floor_hit: true };
    it.each(['U-1', 'U-2', 'U-3', 'U-4'] as const)(
      'floor hit + caller urgency %s -> no emergency question',
      (u) => {
        const d = decide(req({ urgency: u }), sig({}, { emergency: floor }));
        expect(ids(d)).not.toContain('emergency');
      },
    );
    it('floor hit + no urgency -> emergency question present', () => {
      const d = decide(req(), sig({}, { emergency: floor }));
      expect(ids(d)).toContain('emergency');
    });
    it('floor hit + caller U-X (time not known) -> emergency question present', () => {
      const d = decide(req({ urgency: 'U-X' }), sig({}, { emergency: floor }));
      expect(ids(d)).toContain('emergency');
    });
  });
  describe('soft card needs a content word', () => {
    it('soft band, no content word -> no card', () => {
      const d = decide(
        req({ has_content_word: false }),
        sig({}, { emergency: soft }),
      );
      expect(ids(d)).not.toContain('emergency');
    });
    it('soft band, content word -> card', () => {
      const d = decide(
        req({ has_content_word: true }),
        sig({}, { emergency: soft }),
      );
      expect(ids(d)).toContain('emergency');
    });
    it('has_content_word absent -> card (older callers)', () => {
      expect(ids(decide(req(), sig({}, { emergency: soft })))).toContain(
        'emergency',
      );
    });
    it('exempt: floor hit', () => {
      const e = { status: 'ok' as const, score: 0.1, floor_hit: true };
      const d = decide(
        req({ has_content_word: false }),
        sig({}, { emergency: e }),
      );
      expect(ids(d)).toContain('emergency');
    });
    it('exempt: score at or above the popup cutoff (calm context caps the band at soft)', () => {
      const e = { status: 'ok' as const, score: 0.9, calm_context: true };
      const d = decide(
        req({ has_content_word: false }),
        sig({}, { emergency: e }),
      );
      expect(ids(d)).toContain('emergency');
    });
    it('popup band is not touched', () => {
      const d = decide(
        req({ has_content_word: false }),
        sig({}, { emergency: popup }),
      );
      expect(ids(d)).toContain('emergency');
    });
  });
  describe('caller urgency=U-0 (Decision 50)', () => {
    const expectU0Popup = (d: ReturnType<typeof decide>) => {
      const q = d.candidates[0];
      expect(q.id).toBe('emergency');
      expect(q.type).toBe('emergency');
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
  it('need options are {label, description, parameter: needs, value, score}', () => {
    const d = decide(req(), sig({ 'N-HOU': 0.95 }));
    const q = d.candidates.find((c) => c.type === 'find_need');
    expect(q).toBeDefined();
    for (const o of q.options) {
      expect(Object.keys(o)).toEqual([
        'label',
        'description',
        'parameter',
        'value',
        'score',
      ]);
      expect(o.parameter).toBe('needs');
      expect(o.description.length).toBeGreaterThan(0);
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
  it('caller urgency=U-X means time not known: the time question still shows (ISS-2499)', () => {
    const d = decide(req({ urgency: 'U-X' }), askU('U-1'));
    expect(d.urgency).toEqual({
      value: 'U-X',
      source: 'default',
      state: 'ask',
    });
    expect(ids(d)).toContain('urgency_today');
  });
  it('caller urgency=U-X: the model urgency guess is still used (ISS-2499)', () => {
    const s = askU('U-2');
    s.urgency.score = 0.95;
    expect(decide(req({ urgency: 'U-X' }), s).urgency).toEqual({
      value: 'U-2',
      source: 'inferred',
      state: 'use',
    });
  });
  it('caller urgency=U-X does not hide the emergency question (time not known)', () => {
    const s = askU('U-1');
    s.emergency = { status: 'ok', score: 0.9 };
    const d = decide(req({ urgency: 'U-X' }), s);
    expect(ids(d)).toContain('emergency');
    expect(d.emergency_band).toBe('popup');
  });
  it('suppressed when emergency question exists', () => {
    const s = askU('U-1');
    s.emergency = { status: 'ok', score: 0.9 };
    expect(ids(decide(req(), s))).toEqual(['emergency', 'start']);
  });
});

describe('start question', () => {
  it('tiny scores -> every Tier 1, the global default areas first', () => {
    const d = decide(req(), sig({ 'N-FOD': 0.01 }));
    expect(opts(d, 'start').slice(0, 3)).toEqual(['N-HOU', 'N-FOD', 'N-MON']);
    expect([...opts(d, 'start')].sort()).toEqual([...TIER1_CODES].sort());
  });
  it('best T1 0.35 -> every Tier 1, sorted by score, ties in vocabulary order', () => {
    const d = decide(
      req(),
      sig({ 'N-LEG': 0.35, 'N-WRK': 0.2, 'N-LRN': 0.1, 'N-HOU': 0.05 }),
    );
    const o = opts(d, 'start');
    expect(o.slice(0, 4)).toEqual(['N-LEG', 'N-WRK', 'N-LRN', 'N-HOU']);
    expect(o).toHaveLength(TIER1_CODES.length);
    expect(o.slice(4)).toEqual(
      TIER1_CODES.filter((c) => !o.slice(0, 4).includes(c)),
    );
  });
  it('start option count equals the number of Tier 1 needs', () => {
    const d = decide(req(), sig({ 'N-LEG': 0.35 }));
    // eslint-disable-next-line no-console
    console.log(`START_OPTION_COUNT=${opts(d, 'start').length}`);
    expect(opts(d, 'start')).toHaveLength(TIER1_CODES.length);
    expect(TIER1_CODES.length).toBeGreaterThan(3);
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
    expect(opts(d, 'start')).toEqual(TIER1_CODES.filter((c) => c !== 'N-HOU'));
  });
  it('not built when every area is passed (no zero-option question)', () => {
    const d = decide(req({ passed_needs: [...TIER1_CODES] }), sig());
    expect(ids(d)).not.toContain('start');
  });
  it('not built when a Tier 2 at 0.5 makes the area clear (the area question is asked)', () => {
    expect(ids(decide(req(), sig({ 'N-FOD-01': 0.5 })))).toEqual([
      'area:N-FOD',
    ]);
  });
  it('built when the only Tier 2 score is below 0.5', () => {
    expect(ids(decide(req(), sig({ 'N-FOD-01': 0.49 })))).toEqual(['start']);
  });
});

describe('one-word Tier 1 query: food (Lucas 2026-11-17)', () => {
  it('N-FOD 0.851 is used and the area question asks about Food & Water', () => {
    const d = decide(
      req(),
      sig({ 'N-FOD': 0.851, 'N-FOD-01': 0.05, 'N-FOD-02': 0.04 }),
    );
    expect(d.needs.map((n) => [n.code, n.state])).toEqual([['N-FOD', 'use']]);
    expect(ids(d)).toEqual(['area:N-FOD']);
    expect(d.candidates[0].stem).toBe('Which kind of help with Food & Water?');
    expect(d.candidates[0].reason).toBe('area_only');
  });
  it('a clear Tier 1 below the new gate (0.79) asks no area question', () => {
    const d = decide(req(), sig({ 'N-FOD': 0.79 }));
    expect(ids(d)).not.toContain('area:N-FOD');
  });
});

describe('two Tier 1 needs in the text: one which-kind question each, the most uncertain first (Lucas 2026-11-23)', () => {
  const both = { 'N-FOD': 0.9, 'N-HOU': 0.85 };
  const fin = (r: ReturnType<typeof req>, s: ReturnType<typeof sig>, by = {}) =>
    finalize(decide(r, s), {
      counts: { total: 10, by_code: by },
      strong_text_match: false,
    }).questions.map((q) => q.id);
  it('decide builds a question for each need, best score first', () => {
    expect(ids(decide(req(), sig(both)))).toEqual(['area:N-FOD', 'area:N-HOU']);
  });
  it('finalize keeps the need with the higher entropy: the second named need goes first', () => {
    // Food: one clear kind (0.9 vs 0.01). Housing: three close kinds. Housing asks first.
    const s = sig({
      ...both,
      'N-FOD-01': 0.4,
      'N-FOD-02': 0.01,
      'N-FOD-03': 0.01,
      'N-HOU-01': 0.3,
      'N-HOU-02': 0.3,
      'N-HOU-03': 0.3,
    });
    expect(fin(req(), s)).toEqual(['area:N-HOU', 'area:N-FOD']);
  });
  it('all entropies equal (scores 0): more results across the options goes first', () => {
    const food = Object.fromEntries([1, 2, 3].map((i) => [`N-FOD-0${i}`, 0]));
    const hou = Object.fromEntries([1, 2, 3].map((i) => [`N-HOU-0${i}`, 5]));
    // counts add a bonus, so use equal single-count shapes: housing counts are larger.
    expect(fin(req(), sig(both), { ...food, ...hou })).toEqual([
      'area:N-HOU',
      'area:N-FOD',
    ]);
  });
  it('all entropies and results equal: the higher Tier 1 confidence goes first', () => {
    expect(fin(req(), sig(both))).toEqual(['area:N-FOD', 'area:N-HOU']);
  });
  it('live "i need food and housing": food leans to a kind (0.67) but is not clear, so both are asked', () => {
    const s = sig({
      'N-HOU': 0.98,
      'N-FOD': 0.98,
      'N-FOD-01': 0.67,
      'N-ESS-01': 0.14,
    });
    expect(fin(req(), s)).toEqual(['area:N-HOU', 'area:N-FOD']);
  });
  it('live "baby formula and somewhere to live": housing has a kind in use, so food is asked', () => {
    const s = sig({ 'N-HOU': 0.98, 'N-HOU-04': 0.97, 'N-FOD': 0.9 });
    expect(fin(req(), s)).toEqual(['area:N-FOD']);
  });
  it('after the caller answers (needs set), the next need is asked', () => {
    expect(ids(decide(req({ needs: ['N-FOD-01'] }), sig(both)))).toEqual([
      'area:N-HOU',
    ]);
  });
  it('after the caller passes the first need (passed_needs), the next need is asked', () => {
    expect(ids(decide(req({ passed_needs: ['N-FOD'] }), sig(both)))).toEqual([
      'area:N-HOU',
    ]);
  });
  it('both answered -> no which-kind question', () => {
    expect(
      ids(decide(req({ needs: ['N-FOD-01', 'N-HOU-02'] }), sig(both))),
    ).toEqual([]);
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
    expect(opts(d, 'area:N-HOU').slice(0, 3)).toEqual([
      'N-HOU-01',
      'N-HOU-02',
      'N-HOU-03',
    ]);
    expect(d.candidates[0].reason).toBe('area_confirmed');
    expect(d.candidates[0].stem).toBe('Which kind of help with Housing?');
  });
  it('confirmed Tier 1 + unsure needs elsewhere: only the area question (no narrow)', () => {
    const d = decide(
      req({ needs: ['N-HOU'] }),
      sig({ 'N-HOU-02': 0.6, 'N-HOU-01': 0.3, 'N-FOD-01': 0.4 }),
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

describe('no narrow question (Lucas 2026-11-19)', () => {
  it('an unsure need in the text asks no narrow question', () => {
    const d = decide(
      req(),
      sig({ 'N-FOD-01': 0.9, 'N-FOD-02': 0.8, 'N-HOU-01': 0.7 }),
    );
    expect(ids(d).some((i) => i.startsWith('narrow'))).toBe(false);
    expect(d.candidates.every((q) => q.type !== ('narrow' as string))).toBe(
      true,
    );
  });
  it('count_codes excludes N-X', () => {
    const codes = decide(req(), sig({ 'N-X': 0.3 })).count_codes;
    expect(codes).not.toContain('N-X');
    expect(codes).toEqual([...TIER1_CODES].sort());
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
  it('urgency_time is low', () => {
    expect(imp(decide(req(), askU('U-2')), 'urgency_time')).toBe('low');
  });
});

describe('no_match question (weak match, Lucas 2026-11-18)', () => {
  const codes = (q: ReturnType<typeof noMatchQuestion>) =>
    q.options.map((o) => o.value);
  it('no tenant areas: the defaults', () => {
    expect(codes(noMatchQuestion(req(), {}))).toEqual([
      'N-HOU',
      'N-FOD',
      'N-MON',
    ]);
  });
  it('skips passed and confirmed codes', () => {
    const q = noMatchQuestion(
      req({ passed_needs: ['N-HOU'], needs: ['N-FOD'] }),
      {},
    );
    expect(q).toBeNull(); // one option left: never a 1-option question
  });
  it('shape: id, type, importance, reason, step, stem, flags, parameter', () => {
    const q = noMatchQuestion(req(), {});
    expect(q).toMatchObject({
      id: 'no_match',
      type: 'find_need',
      importance: 'high',
      reason: 'weak_match',
      step: 2,
      stem: 'We could not find a good match. What do you need help with?',
      multi_select: true,
      allow_other: true,
      none_of_these: true,
      uncertainty: 1,
    });
    expect(q.options.every((o) => o.parameter === 'needs')).toBe(true);
    expect(q.value).toBeGreaterThan(0);
    expect(q.priority).toBeGreaterThan(1);
  });
  it('null when fewer than 2 options are left', () => {
    expect(
      noMatchQuestion(req({ passed_needs: ['N-HOU', 'N-FOD', 'N-MON'] }), {}),
    ).toBeNull();
  });
});

describe('weakMatchDecision', () => {
  const base = () => decide(req(), sig({ 'N-FOD': 0.2 }));
  it('replaces candidates with the no_match question; count codes and scores follow', () => {
    const d = weakMatchDecision(base(), req(), {});
    expect(d.candidates.map((q) => q.id)).toEqual(['no_match']);
    expect(d.count_codes).toEqual(['N-FOD', 'N-HOU', 'N-MON']);
    expect(d.option_scores).toEqual({ 'N-FOD': 0, 'N-HOU': 0, 'N-MON': 0 });
  });
  it('copies the other fields', () => {
    const b = base();
    const d = weakMatchDecision(b, req(), {});
    expect(d.rules_version).toBe(b.rules_version);
    expect(d.cacheable).toBe(b.cacheable);
    expect(d.urgency).toEqual(b.urgency);
  });
  it('clarify=never: no candidates, no count codes', () => {
    const d = weakMatchDecision(base(), req({ clarify: 'never' }), {});
    expect(d.candidates).toEqual([]);
    expect(d.count_codes).toEqual([]);
    expect(d.option_scores).toEqual({});
  });
  it('no option left: no candidates', () => {
    const r = req({ passed_needs: ['N-HOU', 'N-FOD', 'N-MON'] });
    expect(weakMatchDecision(base(), r, {}).candidates).toEqual([]);
  });
  it('keeps the emergency question (soft card) next to no_match', () => {
    const b = decide(
      req(),
      sig({ 'N-FOD': 0.2 }, { emergency: { status: 'ok', score: 0.3 } }),
    );
    expect(b.candidates.some((q) => q.type === 'emergency')).toBe(true);
    const d = weakMatchDecision(b, req(), {});
    expect(d.candidates.map((q) => q.id)).toEqual(['emergency', 'no_match']);
    expect(
      weakMatchDecision(b, req({ clarify: 'never' }), {}).candidates.map(
        (q) => q.id,
      ),
    ).toEqual(['emergency']);
  });
  it('does not change the input decision', () => {
    const b = base();
    const before = JSON.stringify(b);
    weakMatchDecision(b, req(), {});
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('which kind: every Tier 2 option, scored (Lucas 2026-11-19)', () => {
  const housing = {
    'N-HOU-01': 0.11,
    'N-HOU-02': 0.5,
    'N-HOU-03': 0.09,
    'N-HOU-04': 0.3,
    'N-HOU-05': 0.2,
  };
  const area = (code: string, scores: Record<string, number>) =>
    decide(req({ needs: [code] }), sig(scores)).candidates.find(
      (q) => q.id === `area:${code}`,
    );
  it('area:N-HOU sends every Tier 2 need of housing, not only 3', () => {
    const q = area('N-HOU', housing);
    expect(q.options.length).toBeGreaterThan(3);
    expect(q.options.every((o) => o.value.startsWith('N-HOU-'))).toBe(true);
  });
  it('each option has a score (classifier confidence), sorted high to low', () => {
    const q = area('N-HOU', housing);
    const sc = q.options.map((o) => o.score);
    expect(sc.every((x) => typeof x === 'number' && x >= 0)).toBe(true);
    expect([...sc].sort((a, b) => b - a)).toEqual(sc);
    expect(q.options[0]).toMatchObject({ value: 'N-HOU-02', score: 0.5 });
    expect(q.options.find((o) => o.value === 'N-HOU-01').score).toBe(0.11);
  });
  it('a need the model did not score gets score 0', () => {
    const q = area('N-FOD', { 'N-FOD-01': 0.4 });
    expect(q.options.every((o) => o.score >= 0)).toBe(true);
    expect(q.options[0].score).toBe(0.4);
  });
  it('option counts for food and housing (all Tier 2 needs)', () => {
    const h = area('N-HOU', {}).options.length;
    const f = area('N-FOD', {}).options.length;
    // eslint-disable-next-line no-console
    console.log(`OPTION_COUNTS food=${f} housing=${h}`);
    expect(h).toBeGreaterThan(3);
    expect(f).toBeGreaterThan(3);
  });
  it('never a question with fewer than 2 options', () => {
    // Every housing need but one is passed: one option left -> no area question.
    const kids = Object.keys(housing);
    const d = decide(
      req({ needs: ['N-HOU'], passed_needs: ['N-HOU-02', 'N-HOU-03'] }),
      sig({}),
    );
    const left = d.candidates.find((q) => q.id === 'area:N-HOU');
    expect(left === undefined || left.options.length >= 2).toBe(true);
    expect(kids.length).toBeGreaterThan(0);
    for (const q of d.candidates.filter((c) => c.type === 'find_need')) {
      expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('finalize drops a need question left with 1 option', () => {
    const d = decide(req({ needs: ['N-HOU'] }), sig(housing));
    const q = d.candidates.find((c) => c.id === 'area:N-HOU');
    q.options = q.options.slice(0, 1);
    const r = finalize(d, {
      counts: { total: 10, by_code: { [q.options[0].value]: 4 } },
      strong_text_match: false,
    });
    expect(r.questions.find((x) => x.id === 'area:N-HOU')).toBeUndefined();
  });
  const fin = (by_code: Record<string, number> | null, total = 10) => {
    const d = decide(req({ needs: ['N-HOU'] }), sig(housing));
    const r = finalize(d, {
      counts: { total: by_code ? total : null, by_code },
      strong_text_match: false,
    });
    return r.questions.find((x) => x.id === 'area:N-HOU');
  };
  const bonus = (count: number, max: number) =>
    (0.3 * Math.log(1 + count)) / Math.log(1 + max);
  it('finalize: score = confidence + 0.3 * log(1+count)/log(1+max count)', () => {
    const q = fin({
      'N-HOU-01': 0,
      'N-HOU-02': 10,
      'N-HOU-03': 99,
      'N-HOU-04': 3,
      'N-HOU-05': 0,
    });
    const sc = (v: string) => q.options.find((o) => o.value === v).score;
    expect(sc('N-HOU-03')).toBeCloseTo(0.09 + 0.3, 3);
    expect(sc('N-HOU-02')).toBeCloseTo(0.5 + bonus(10, 99), 3);
    expect(sc('N-HOU-04')).toBeCloseTo(0.3 + bonus(3, 99), 3);
    // 0 count: no bonus, still listed
    expect(sc('N-HOU-01')).toBe(0.11);
    expect(sc('N-HOU-05')).toBe(0.2);
    const s = q.options.map((o) => o.score);
    expect([...s].sort((a, b) => b - a)).toEqual(s);
  });
  it('finalize: a big count can lift a lower-confidence option above a higher one', () => {
    const q = fin({
      'N-HOU-01': 0,
      'N-HOU-02': 0,
      'N-HOU-03': 0,
      'N-HOU-04': 100,
      'N-HOU-05': 0,
    });
    expect(q.options.map((o) => o.value).slice(0, 2)).toEqual([
      'N-HOU-04',
      'N-HOU-02',
    ]);
    expect(q.options[0].score).toBeCloseTo(0.6, 3);
  });
  it('finalize: all counts 0 -> score is the confidence, no divide by zero', () => {
    const q = fin({});
    expect(q.options[0]).toMatchObject({ value: 'N-HOU-02', score: 0.5 });
    expect(q.options.every((o) => Number.isFinite(o.score))).toBe(true);
  });
  it('finalize: ties keep vocabulary order', () => {
    const d = decide(req({ needs: ['N-HOU'] }), sig({}));
    const r = finalize(d, {
      counts: { total: 10, by_code: { 'N-HOU-01': 5, 'N-HOU-02': 5 } },
      strong_text_match: false,
    });
    const q = r.questions.find((x) => x.id === 'area:N-HOU');
    expect(q.options.slice(0, 2).map((o) => o.value)).toEqual([
      'N-HOU-01',
      'N-HOU-02',
    ]);
  });
  it('finalize: count null (not counted) contributes 0, the score is the confidence', () => {
    const q = fin(null);
    expect(q.options[0]).toMatchObject({ value: 'N-HOU-02', score: 0.5 });
  });
  it('finalize keeps option order and score', () => {
    const d = decide(req({ needs: ['N-HOU'] }), sig(housing));
    const by: Record<string, number> = {};
    for (const o of d.candidates[0].options) by[o.value] = 3;
    const r = finalize(d, {
      counts: { total: 10, by_code: by },
      strong_text_match: false,
    });
    const q = r.questions.find((x) => x.id === 'area:N-HOU');
    expect(q.options.map((o) => o.score)).toEqual(
      [...q.options.map((o) => o.score)].sort((a, b) => b - a),
    );
  });
});
