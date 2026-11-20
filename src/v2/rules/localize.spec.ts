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

  it('es: area stem, need label and urgency labels are Spanish', () => {
    const out = localizeClarification(hand(), 'es');
    const area = find(out, 'area:N-FOD');
    expect(area.stem).toBe('¿Qué tipo de ayuda con Comida y agua?');
    expect(area.options[0].label).not.toBe('Money for Food');
    const time = find(out, 'urgency');
    expect(time.stem).not.toBe(find(hand(), 'urgency').stem);
    expect(time.options.map((o) => o.label)).not.toEqual(
      find(hand(), 'urgency').options.map((o) => o.label),
    );
  });

  it('ko: the danger question is Korean; need and time questions stay English', () => {
    const out = localizeClarification(
      { ...hand(), questions: [...emergency().questions, ...hand().questions] },
      'ko',
    );
    expect(find(out, 'emergency').stem).toBe('지금 위험한 상황에 있으신가요?');
    expect(find(out, 'area:N-FOD')).toEqual(find(hand(), 'area:N-FOD'));
    expect(find(out, 'urgency')).toEqual(find(hand(), 'urgency'));
  });

  it('lowercases the language code', () => {
    const out = localizeClarification(hand(), 'ES');
    expect(find(out, 'area:N-FOD').stem).toBe(
      '¿Qué tipo de ayuda con Comida y agua?',
    );
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
    expect(find(localizeClarification(c, 'es'), 'urgency').stem).toBe(
      'Something new',
    );
  });

  it('does not mutate the input', () => {
    const c = hand();
    const before = clone(c);
    localizeClarification(c, 'ko');
    expect(c).toEqual(before);
  });

  it('es covers every stem, urgency, emergency answer and need code', () => {
    const codes = [...TIER1_CODES, ...TIER2_CODES];
    const t = LOCALE_TABLES.es;
    expect(Object.keys(t.stems).sort()).toEqual(Object.keys(STEMS).sort());
    expect(Object.keys(t.urgency).sort()).toEqual(
      Object.keys(LABELS.urgency).sort(),
    );
    expect(Object.keys(t.emergency).sort()).toEqual(
      Object.keys(LABELS.emergency).sort(),
    );
    expect(codes.filter((c) => !t.needs[c])).toEqual([]);
  });

  it('vi ru ko am zh-hans hold the danger question and its answers only', () => {
    for (const lang of ['vi', 'ru', 'ko', 'am', 'zh-hans']) {
      const t = LOCALE_TABLES[lang];
      expect(Object.keys(t.stems)).toEqual(['emergency']);
      expect(Object.keys(t.urgency)).toEqual([]);
      expect(Object.keys(t.needs)).toEqual([]);
      expect(Object.keys(t.emergency).sort()).toEqual(
        Object.keys(LABELS.emergency).sort(),
      );
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
      if (t.stems.area) expect(t.stems.area.text).toContain('{area}');
    }
  });
});
