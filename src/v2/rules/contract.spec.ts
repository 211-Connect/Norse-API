import { placementOf, toContractClarification } from './contract';
import { req, sig } from '../../common/testing/v2-rules-helpers';
import { DEFAULT_HOTLINES, PHONE_LINE, STEMS } from './config';
import { decide, finalize } from './engine';
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
  const rows: [string, Pick<Question, 'type' | 'importance'>, string][] = [
    [
      'danger, strong band',
      { type: 'emergency', importance: 'critical' },
      'popup',
    ],
    [
      'danger, soft band',
      { type: 'emergency', importance: 'high' },
      'before_results',
    ],
    [
      'need: start / spread / least-certain area / no_match',
      { type: 'find_need', importance: 'high' },
      'before_results',
    ],
    [
      '"is it urgent today?"',
      { type: 'confirm_urgency', importance: 'high' },
      'before_results',
    ],
    [
      'likely kind and other open R3 areas',
      { type: 'find_need', importance: 'medium' },
      'with_results',
    ],
    [
      '"how soon?"',
      { type: 'confirm_urgency', importance: 'low' },
      'with_results',
    ],
  ];
  it.each(rows)('%s', (_n, input, placement) => {
    expect(placementOf(input)).toBe(placement);
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

  it('keeps an option description; an option without one has no key', () => {
    const question = q({ id: 'start', type: 'find_need' });
    question.options[0].description = 'Rent and shelter';
    const [out] = toContractClarification(clar(question)).questions;
    expect(out.options[0].description).toBe('Rent and shelter');
    expect(out.options[1]).not.toHaveProperty('description');
  });
});

describe('question contract v2: hotlines', () => {
  it('pass through on the danger question; absent elsewhere', () => {
    const out = toContractClarification(
      clar(emergencyQ('critical'), q({ id: 'start', type: 'find_need' })),
    );
    expect(out.questions[0].hotlines).toEqual(DEFAULT_HOTLINES);
    expect(out.questions[1]).not.toHaveProperty('hotlines');
  });
});

describe('question contract v2: the rest of the clarification', () => {
  it('keeps notice, phone_line and rules_version', () => {
    const c = {
      ...clar(),
      notice: { kind: 'may_not_match' as const, text: 'n' },
      phone_line: { label: 'Call 211', number: '211' },
    };
    expect(toContractClarification(c)).toEqual(c);
  });
  it('a new engine field never reaches the response', () => {
    const c = { ...clar(), engine_only: 1 };
    const leaky = { ...q({ id: 'a', type: 'find_need' }), engine_only: 1 };
    Object.assign(leaky.options[0], { engine_only: 1 });
    c.questions = [leaky];
    const out = toContractClarification(c);
    expect(JSON.stringify(out)).not.toContain('engine_only');
    expect(Object.keys(out)).toEqual(['rules_version', 'questions']);
  });
  it('does not change its input', () => {
    const c = clar(emergencyQ('critical'), q({ id: 'a', type: 'find_need' }));
    const before = JSON.stringify(c);
    toContractClarification(c);
    expect(JSON.stringify(c)).toBe(before);
  });
  it('R5: the notice and the phone line come with the question they point to', () => {
    const out = toContractClarification(
      finalize(decide(req({ query: 'x', content_words: ['x'] }), sig({})), {
        counts: { total: 10, by_code: null },
        match: 'none',
      }),
    );
    expect(out.questions.map((x) => [x.id, x.placement])).toEqual([
      ['start', 'before_results'],
    ]);
    expect(out.notice?.text).toBe(STEMS.notice);
    expect(out.phone_line).toEqual(PHONE_LINE);
  });
});
