import { decide, finalize } from './engine';
import { LABELS, STEMS } from './config';
import { LOCALE_TABLES } from './locales';
import { localizeClarification } from './localize';
import { displayOf, TIER1_CODES, TIER2_CODES } from './sune';
import { Clarification, Question } from './types';
import { req, sig } from '../../common/testing/v2-rules-helpers';

const popup = { status: 'ok' as const, score: 0.9, floor_hit: false };
const counts = { total: null, by_code: null };
const emergency = (): Clarification =>
  finalize(decide(req(), sig({}, { emergency: popup })), {
    counts,
    strong_text_match: false,
  });
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const find = (c: Clarification, id: string): Question =>
  c.questions.find((q) => q.id === id);

// A need question with a tier-2 code, an area question and a urgency question, built by hand.
const hand = (): Clarification => ({
  rules_version: 'x',
  questions: [
    {
      id: 'area:N-FOD',
      type: 'find_need',
      importance: 'high',
      value: 0,
      priority: 0,
      uncertainty: 0,
      reason: 'area_only',
      step: 3,
      stem: STEMS.area.replace('{area}', displayOf('N-FOD')),
      options: [
        { label: displayOf('N-FOD-01'), parameter: 'needs', value: 'N-FOD-01' },
      ],
      multi_select: true,
      allow_other: true,
      none_of_these: true,
    },
    {
      id: 'urgency',
      type: 'confirm_urgency',
      importance: 'high',
      value: 0,
      priority: 0,
      uncertainty: 0,
      reason: 'urgency_unsure',
      step: 1,
      stem: STEMS.time,
      options: [
        { label: LABELS.urgency['U-1'], parameter: 'urgency', value: 'U-1' },
        { label: LABELS.urgency['U-3'], parameter: 'urgency', value: 'U-3' },
      ],
      multi_select: false,
      allow_other: false,
      none_of_these: false,
    },
  ],
});

describe('localizeClarification', () => {
  it('en: returns the same object, unchanged', () => {
    const c = emergency();
    const before = clone(c);
    expect(localizeClarification(c, 'en')).toBe(c);
    expect(c).toEqual(before);
  });

  it('no table (unknown or missing language): English', () => {
    const c = emergency();
    expect(localizeClarification(c, 'de')).toBe(c);
    expect(localizeClarification(c, undefined)).toBe(c);
  });

  it('es: emergency stem and the three answers are Spanish; urgency codes stay', () => {
    const out = localizeClarification(emergency(), 'es');
    const q = find(out, 'emergency');
    expect(q.stem).toBe('¿Está en peligro en este momento?');
    expect(q.options.map((o) => o.value)).toEqual(['U-0', 'U-1', 'U-2']);
    expect(q.options[0].label).toBe('Sí, estoy en peligro en este momento');
    expect(q.hotlines).toEqual(find(emergency(), 'emergency').hotlines);
  });

  it('zh-hans: area stem, need label and urgency labels are Chinese', () => {
    const out = localizeClarification(hand(), 'zh-hans');
    const area = find(out, 'area:N-FOD');
    expect(area.stem).toBe('关于食物和饮水，需要哪种帮助？');
    expect(area.options[0]).toEqual({
      label: '购买食物的资金',
      parameter: 'needs',
      value: 'N-FOD-01',
    });
    const time = find(out, 'urgency');
    expect(time.stem).toBe('您什么时候需要？');
    expect(time.options.map((o) => o.label)).toEqual(['今天', '不紧急']);
  });

  it('lowercases the language code', () => {
    const out = localizeClarification(hand(), 'ZH-Hans');
    expect(find(out, 'urgency').stem).toBe('您什么时候需要？');
  });

  it('unknown key falls back to English, other keys still translate', () => {
    const saved = LOCALE_TABLES.es.needs['N-FOD-01'];
    delete LOCALE_TABLES.es.needs['N-FOD-01'];
    try {
      const out = localizeClarification(hand(), 'es');
      const area = find(out, 'area:N-FOD');
      expect(area.options[0].label).toBe('Money for Food');
      expect(area.stem).toBe('¿Qué tipo de ayuda con Comida y agua?');
    } finally {
      LOCALE_TABLES.es.needs['N-FOD-01'] = saved;
    }
  });

  it('a stem with no key (unknown text) stays as it is', () => {
    const c = hand();
    c.questions[1].stem = 'Something new';
    expect(find(localizeClarification(c, 'vi'), 'urgency').stem).toBe(
      'Something new',
    );
  });

  it('does not mutate the input', () => {
    const c = hand();
    const before = clone(c);
    localizeClarification(c, 'ko');
    expect(c).toEqual(before);
  });

  it('every language covers every stem, urgency, emergency answer and need code', () => {
    const codes = [...TIER1_CODES, ...TIER2_CODES];
    for (const [lang, t] of Object.entries(LOCALE_TABLES)) {
      expect(Object.keys(t.stems).sort()).toEqual(Object.keys(STEMS).sort());
      expect(Object.keys(t.urgency).sort()).toEqual(
        Object.keys(LABELS.urgency).sort(),
      );
      expect(Object.keys(t.emergency).sort()).toEqual(
        Object.keys(LABELS.emergency).sort(),
      );
      expect(codes.filter((c) => !t.needs[c])).toEqual([]);
      expect(lang).toBe(lang.toLowerCase());
    }
    expect(Object.keys(LOCALE_TABLES).sort()).toEqual(
      ['am', 'es', 'ko', 'ru', 'vi', 'zh-hans'].sort(),
    );
  });

  it('every non-English entry is marked needs_review', () => {
    for (const t of Object.values(LOCALE_TABLES)) {
      for (const group of Object.values(t)) {
        for (const e of Object.values(group)) {
          expect(e.status).toBe('needs_review');
          expect(e.text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('the area stem placeholder is kept in every language', () => {
    for (const t of Object.values(LOCALE_TABLES)) {
      expect(t.stems.area.text).toContain('{area}');
    }
  });
});
