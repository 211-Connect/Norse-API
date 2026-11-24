import {
  localizedStrings,
  placementAndStyle,
  toContractClarification,
} from './contract';
import { req, sig } from '../../common/testing/v2-rules-helpers';
import { DEFAULT_HOTLINES, PHONE_LINE, STEMS } from './config';
import { decide, finalize } from './engine';
import { localizeClarification } from './localize';
import { LOCALE_TABLES } from './locales';
import type {
  Clarification,
  FinalizeInput,
  Question,
  QuestionImportance,
} from './types';

const q = (
  over: Partial<Question> & Pick<Question, 'id' | 'type'>,
): Question => ({
  importance: 'high',
  value: 0.5,
  priority: 1.5,
  uncertainty: 0.4,
  reason: 'no_need',
  step: 2,
  stem: 'stem',
  options: [
    {
      label: 'A',
      parameter: 'needs',
      value: 'N-HOU',
      results_count: 4,
      score: 0.9,
    },
    {
      label: 'B',
      parameter: 'needs',
      value: 'N-FOD',
      results_count: null,
      score: 0.5,
    },
  ],
  multi_select: true,
  allow_other: true,
  none_of_these: true,
  ...over,
});
const emergencyQ = (importance: QuestionImportance): Question =>
  q({
    id: 'emergency',
    type: 'emergency',
    importance,
    reason: 'emergency_band',
    step: 0,
    stem: STEMS.emergency,
    options: [
      { label: 'Yes', parameter: 'urgency', value: 'U-0', results_count: null },
    ],
    multi_select: false,
    allow_other: false,
    none_of_these: false,
    hotlines: DEFAULT_HOTLINES,
  });
const clar = (...questions: Question[]): Clarification => ({
  rules_version: 'v',
  questions,
});

describe('question contract v2: mapping rows', () => {
  const rows: [
    string,
    Pick<Question, 'type' | 'importance'>,
    string,
    string,
  ][] = [
    [
      'danger, strong band',
      { type: 'emergency', importance: 'critical' },
      'popup',
      'strong',
    ],
    [
      'danger, soft band',
      { type: 'emergency', importance: 'high' },
      'before_results',
      'strong',
    ],
    [
      'need: start / spread / least-certain area / no_match',
      { type: 'find_need', importance: 'high' },
      'before_results',
      'standard',
    ],
    [
      '"is it urgent today?"',
      { type: 'confirm_urgency', importance: 'high' },
      'before_results',
      'standard',
    ],
    [
      'likely kind and other open R3 areas',
      { type: 'find_need', importance: 'medium' },
      'with_results',
      'subtle',
    ],
    [
      '"how soon?"',
      { type: 'confirm_urgency', importance: 'low' },
      'with_results',
      'subtle',
    ],
  ];
  it.each(rows)('%s', (_n, input, placement, style) => {
    expect(placementAndStyle(input)).toEqual({ placement, style });
  });

  it('maps the type names', () => {
    const out = toContractClarification(
      clar(
        q({ id: 'urgency_today', type: 'confirm_urgency' }),
        q({ id: 'start', type: 'find_need' }),
      ),
      'en',
    );
    expect(out.questions.map((x) => x.type)).toEqual(['urgency', 'need']);
  });

  it('removes importance, priority, value, uncertainty, reason, step and option score', () => {
    const [out] = toContractClarification(
      clar(q({ id: 'start', type: 'find_need' })),
      'en',
    ).questions;
    for (const k of [
      'importance',
      'priority',
      'value',
      'uncertainty',
      'reason',
      'step',
    ]) {
      expect(out).not.toHaveProperty(k);
    }
    for (const o of out.options) expect(o).not.toHaveProperty('score');
    expect(out.options.map((o) => o.results_count)).toEqual([4, null]);
  });
});

describe('question contract v2: hotlines', () => {
  it('pass through on the danger question; absent elsewhere', () => {
    const out = toContractClarification(
      clar(emergencyQ('critical'), q({ id: 'start', type: 'find_need' })),
      'en',
    );
    expect(out.questions[0].hotlines).toEqual(DEFAULT_HOTLINES);
    expect(out.questions[1]).not.toHaveProperty('hotlines');
  });
});

describe('question contract v2: words', () => {
  it('English', () => {
    expect(toContractClarification(clar(), 'en').strings).toEqual({
      popup_title: 'Are you in danger right now?',
      skip_to_results: 'Skip to results',
      also_fit_one: 'Does this also fit?',
    });
  });
  it('Spanish, also for a region tag', () => {
    const es = {
      popup_title: '¿Está en peligro en este momento?',
      skip_to_results: 'Ir a los resultados',
      also_fit_one: '¿Esto también se ajusta?',
    };
    expect(localizedStrings('es')).toEqual(es);
    expect(localizedStrings('es-MX')).toEqual(es);
  });
  it('Chinese: the popup title is translated, like the question under it; the rest is English', () => {
    expect(localizedStrings('zh-hans')).toEqual({
      popup_title: '您现在处于危险中吗？',
      skip_to_results: 'Skip to results',
      also_fit_one: 'Does this also fit?',
    });
  });
  it.each(Object.keys(LOCALE_TABLES))(
    '%s: the popup title is the stem of the danger question',
    (lang) => {
      const [danger] = localizeClarification(
        clar(emergencyQ('critical')),
        lang,
      ).questions;
      expect(localizedStrings(lang).popup_title).toBe(danger.stem);
    },
  );
  it.each([['zh-hant'], ['de'], [undefined]])(
    '%s: no table, English',
    (lang) => {
      expect(localizedStrings(lang).popup_title).toBe(STEMS.emergency);
    },
  );
});

describe('question contract v2: unchanged parts', () => {
  it('keeps notice, phone_line and rules_version', () => {
    const c = {
      ...clar(),
      notice: { kind: 'may_not_match' as const, text: 'n' },
      phone_line: { label: 'Call 211', number: '211' },
    };
    expect(toContractClarification(c, 'en')).toMatchObject(c);
  });
  it('does not change its input', () => {
    const c = clar(emergencyQ('critical'), q({ id: 'a', type: 'find_need' }));
    const before = JSON.stringify(c);
    toContractClarification(c, 'es');
    expect(JSON.stringify(c)).toBe(before);
  });
});

// What the mapping relies on: the engine keeps these rules, not this file.
describe('question contract v2: rules the engine owns', () => {
  const total = { total: 10, by_code: null };
  const ask = (
    scores: Record<string, number>,
    o: Parameters<typeof sig>[1] = {},
    r: Parameters<typeof req>[0] = {},
    f: Partial<FinalizeInput> = {},
  ) =>
    finalize(
      decide(req({ query: 'x', content_words: ['x'], ...r }), sig(scores, o)),
      {
        counts: total,
        strong_text_match: false,
        ...f,
      },
    );
  const ids = (c: { questions: { id: string }[] }) =>
    c.questions.map((x) => x.id);
  const soft = { status: 'ok' as const, score: 0.5, floor_hit: true };
  const strong = { status: 'ok' as const, score: 0.9, floor_hit: true };
  const today = { level: 'U-1' as const, score: 0.85 };
  const three = ['a', 'b', 'c'];
  const TWO_AREAS = { 'N-HOU': 0.9, 'N-FOD': 0.85, 'N-MON': 0.82 };

  it('no urgency question beside danger, nor after its answer', () => {
    expect(ids(ask({}, { urgency: today }))).toContain('urgency_today');
    for (const emergency of [soft, strong]) {
      const c = ask({}, { urgency: today, emergency });
      expect(ids(c)[0]).toBe('emergency');
      expect(ids(c)).not.toContain('urgency_today');
    }
    for (const urgency of ['U-0', 'U-1', 'U-2', 'U-3', 'U-4'] as const) {
      const c = ask({}, { urgency: today, emergency: strong }, { urgency });
      expect(ids(c)).not.toContain('urgency_today');
      // Hotlines go with the danger question: U-0 keeps both, a safe answer neither.
      const danger = c.questions.find((x) => x.type === 'emergency');
      expect(!!danger?.hotlines?.length).toBe(urgency === 'U-0');
    }
    expect(
      ask({}, { emergency: strong }, { urgency: 'U-X' }).questions[0].hotlines,
    ).toEqual(DEFAULT_HOTLINES);
  });

  it('no option stands for "none": every option writes a value to the URL', () => {
    for (const c of [
      ask({}),
      ask(TWO_AREAS),
      ask({}, { emergency: strong }),
      ask({}, { urgency: today }),
    ]) {
      for (const x of c.questions) {
        for (const o of x.options) {
          expect(o.parameter).not.toBeNull();
          expect(o.value).toMatch(/^(N|U)-/);
        }
      }
    }
  });

  it('cap: below 3 distinct ids nothing changes; repeated ids count once', () => {
    const base = ask(TWO_AREAS);
    expect(ask(TWO_AREAS, {}, {}, { asked: ['a', 'b'] })).toEqual(base);
    expect(ask(TWO_AREAS, {}, {}, { asked: ['a', 'a', 'a', 'b'] })).toEqual(
      base,
    );
    expect(ask(TWO_AREAS, {}, {}, { asked: [] })).toEqual(base);
  });

  it('cap: only questions beside the results stay, and they take the free place', () => {
    const before = toContractClarification(
      ask(TWO_AREAS, { urgency: today }),
      'en',
    );
    // 4 candidates, 3 places: one quiet area question does not fit.
    expect(before.questions.map((x) => x.placement).sort()).toEqual([
      'before_results',
      'before_results',
      'with_results',
    ]);
    const after = toContractClarification(
      ask(TWO_AREAS, { urgency: today }, {}, { asked: three }),
      'en',
    );
    expect(after.questions.map((x) => x.placement)).toEqual([
      'with_results',
      'with_results',
    ]);
  });

  it.each([
    ['soft', soft],
    ['strong', strong],
  ])('cap: never cuts the danger question (%s band)', (_n, emergency) => {
    const c = ask({}, { emergency }, {}, { asked: three });
    expect(ids(c)).toEqual(['emergency']);
    expect(c.questions[0].hotlines).toEqual(DEFAULT_HOTLINES);
  });

  it('cap: caller U-0 keeps the hotlines', () => {
    const c = ask({}, {}, { urgency: 'U-0' }, { asked: three });
    expect(c.questions[0].hotlines).toEqual(DEFAULT_HOTLINES);
  });

  it('cap in R5: the notice goes with the question it points to', () => {
    const r5 = ask({}, {}, {}, { match: 'none' });
    expect(ids(r5)).toEqual(['start']);
    expect(r5.notice).toBeDefined();
    const capped = ask({}, {}, {}, { match: 'none', asked: three });
    expect(capped.questions).toEqual([]);
    expect(capped).not.toHaveProperty('notice');
    expect(capped).not.toHaveProperty('phone_line');
  });

  it('cap with no results: no question, the phone line stays', () => {
    const c = ask(
      {},
      {},
      {},
      {
        counts: { total: 0, by_code: null },
        asked: three,
      },
    );
    expect(c.questions).toEqual([]);
    expect(c.phone_line).toEqual(PHONE_LINE);
  });
});
