import {
  localizedStrings,
  MAX_BEFORE_RESULTS,
  placementAndStyle,
  toContractClarification,
} from './contract';
import { DEFAULT_HOTLINES, STEMS, UI_STRINGS } from './config';
import { LOCALE_TABLES } from './locales';
import type { Clarification, Question, QuestionImportance } from './types';

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
    );
    expect(out.questions.map((x) => x.type)).toEqual(['urgency', 'need']);
  });

  it('removes importance, priority, value, uncertainty, reason, step and option score', () => {
    const [out] = toContractClarification(
      clar(q({ id: 'start', type: 'find_need' })),
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

describe('question contract v2: rule 1 (no urgency beside danger)', () => {
  it('drops the urgency question when the danger question is present', () => {
    const out = toContractClarification(
      clar(
        emergencyQ('high'),
        q({ id: 'urgency_today', type: 'confirm_urgency' }),
      ),
    );
    expect(out.questions.map((x) => x.id)).toEqual(['emergency']);
  });
  it('keeps the urgency question when there is no danger question', () => {
    const out = toContractClarification(
      clar(q({ id: 'urgency_today', type: 'confirm_urgency' })),
    );
    expect(out.questions.map((x) => x.id)).toEqual(['urgency_today']);
  });
});

describe('question contract v2: rule 2 (guide cap)', () => {
  const qs = () =>
    clar(
      q({ id: 'start', type: 'find_need' }),
      q({ id: 'area:N-HOU', type: 'find_need', importance: 'medium' }),
    );
  it('sends before_results below the cap', () => {
    expect(MAX_BEFORE_RESULTS).toBe(3);
    const out = toContractClarification(qs(), { asked: ['a', 'b'] });
    expect(out.questions.map((x) => x.id)).toEqual(['start', 'area:N-HOU']);
  });
  it('after 3 distinct asked ids, drops before_results and keeps with_results', () => {
    const out = toContractClarification(qs(), { asked: ['a', 'b', 'c'] });
    expect(out.questions.map((x) => x.id)).toEqual(['area:N-HOU']);
  });
  it('repeated ids count once', () => {
    const out = toContractClarification(qs(), { asked: ['a', 'a', 'a', 'b'] });
    expect(out.questions).toHaveLength(2);
  });
  it('never cuts the danger question (safety path)', () => {
    const out = toContractClarification(clar(emergencyQ('high')), {
      asked: ['a', 'b', 'c', 'd'],
    });
    expect(out.questions.map((x) => x.id)).toEqual(['emergency']);
  });
});

describe('question contract v2: rule 3 (none of these)', () => {
  it('sends only the flag: a fake none option is removed', () => {
    const fake = q({
      id: 'start',
      type: 'find_need',
      options: [
        { label: 'A', parameter: 'needs', value: 'N-HOU', results_count: 1 },
        {
          label: 'None of these',
          parameter: null,
          value: 'none_of_these',
          results_count: null,
        },
        {
          label: 'No match',
          parameter: 'needs',
          value: 'no_match',
          results_count: null,
        },
      ],
    });
    const [out] = toContractClarification(clar(fake)).questions;
    expect(out.options.map((o) => o.value)).toEqual(['N-HOU']);
    expect(out.none_of_these).toBe(true);
  });
});

describe('question contract v2: rule 4 (hotlines)', () => {
  it('sends the hotlines on the danger question', () => {
    const [out] = toContractClarification(
      clar(emergencyQ('critical')),
    ).questions;
    expect(out.hotlines).toEqual(DEFAULT_HOTLINES);
  });
  it('omits them once a safe urgency answer is set (U-1 to U-4)', () => {
    for (const urgency of ['U-1', 'U-2', 'U-3', 'U-4'] as const) {
      const [out] = toContractClarification(clar(emergencyQ('critical')), {
        urgency,
      }).questions;
      expect(out).not.toHaveProperty('hotlines');
    }
  });
  it('keeps them for U-0 and U-X', () => {
    for (const urgency of ['U-0', 'U-X'] as const) {
      const [out] = toContractClarification(clar(emergencyQ('critical')), {
        urgency,
      }).questions;
      expect(out.hotlines).toEqual(DEFAULT_HOTLINES);
    }
  });
  it('never puts hotlines on another question', () => {
    const [out] = toContractClarification(
      clar(q({ id: 'start', type: 'find_need', hotlines: DEFAULT_HOTLINES })),
    ).questions;
    expect(out).not.toHaveProperty('hotlines');
  });
});

describe('question contract v2: rule 5 (words)', () => {
  it('English strings', () => {
    expect(toContractClarification(clar()).strings).toEqual({
      popup_title: UI_STRINGS.popupTitle,
      skip_to_results: UI_STRINGS.skipToResults,
      also_fit_one: UI_STRINGS.alsoFitOne,
    });
  });
  it('Spanish strings from the table', () => {
    const es = LOCALE_TABLES.es.strings;
    expect(localizedStrings('es')).toEqual({
      popup_title: es?.popupTitle?.text,
      skip_to_results: es?.skipToResults?.text,
      also_fit_one: es?.alsoFitOne?.text,
    });
  });
  it('a language with no entry falls back to English', () => {
    expect(localizedStrings('vi').popup_title).toBe(UI_STRINGS.popupTitle);
    expect(localizedStrings(undefined).skip_to_results).toBe(
      UI_STRINGS.skipToResults,
    );
  });
});

describe('question contract v2: rule 6 and unchanged parts', () => {
  it('keeps notice and phone_line', () => {
    const c = {
      ...clar(),
      notice: { kind: 'may_not_match' as const, text: 'n' },
      phone_line: { label: 'Call 211', number: '211' },
    };
    const out = toContractClarification(c);
    expect(out.notice).toEqual(c.notice);
    expect(out.phone_line).toEqual(c.phone_line);
  });
  it('does not change its input', () => {
    const c = clar(emergencyQ('critical'));
    const before = JSON.stringify(c);
    toContractClarification(c, { urgency: 'U-1', asked: ['a', 'b', 'c'] });
    expect(JSON.stringify(c)).toBe(before);
  });
});
