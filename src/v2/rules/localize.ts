import { matchLocale } from '../../common/locales';
import { LOCALE_TABLES } from './locales';
import { STEMS } from './config';
import { displayOf } from './sune';
import { Clarification, Question, QuestionOption, RulesSignals } from './types';

/** Languages with the full v2 features (Lucas 2026-11-20). Every other locale gets the danger question only. */
const FULL_V2_LANGUAGES = new Set(['en', 'es']);

export const isFullV2Locale = (lang: string | undefined): boolean =>
  !lang ||
  !!matchLocale(lang, (t) => (FULL_V2_LANGUAGES.has(t) ? t : undefined));

/**
 * For a limited locale the danger question needs a keyword-floor hit. The
 * model score alone gives no emergency band (score 0, band none).
 */
export function floorOnlyEmergency(signals: RulesSignals): RulesSignals {
  const e = signals.emergency;
  // An error stays an error (band `unknown` keeps the danger question, and the
  // answer is not cached). Only a score the floor checked and did not hit
  // (`floor_hit === false`) is dropped; an unknown floor (null/undefined) keeps
  // the model score, so a missing floor never hides the danger question.
  if (!e || e.status !== 'ok' || e.floor_hit !== false) return signals;
  return { ...signals, emergency: { status: 'ok', score: 0 } };
}

const EMERGENCY_KEY: Record<string, string> = {
  'U-0': 'yes',
  'U-1': 'safeToday',
  'U-2': 'safeSoon',
};

const text = (
  group: Partial<Record<string, { text: string }>> | undefined,
  key: string | null | undefined,
): string | undefined => (key ? group?.[key]?.text : undefined);

/**
 * Translates question stems, answer labels, urgency labels and need display
 * names into `lang` (lowercase code). A missing key keeps the English text.
 * English, and a language without a table, return the input object unchanged.
 * Pure: the input is not mutated.
 */
export function localizeClarification(
  clarification: Clarification,
  lang: string | undefined,
): Clarification {
  const table = matchLocale(lang, (t) => LOCALE_TABLES[t]);
  if (!table) return clarification;

  const stemKeyOf = (q: Question): string | null => {
    if (q.id.startsWith('area:')) return 'area';
    for (const [k, en] of Object.entries(STEMS)) {
      if (en === q.stem) return k;
    }
    return null;
  };

  const option = (q: Question, o: QuestionOption): QuestionOption => {
    let label: string | undefined;
    if (o.parameter === 'needs' || o.parameter === 'passed_needs') {
      label = text(table.needs, o.value);
    } else if (o.parameter === 'urgency' && o.value) {
      const emergencyKey = EMERGENCY_KEY[o.value];
      label =
        q.type === 'emergency'
          ? text(table.emergency, emergencyKey)
          : text(table.urgency, o.value);
    }
    return label ? { ...o, label } : o;
  };

  const question = (q: Question): Question => {
    const key = stemKeyOf(q);
    let stem = text(table.stems, key);
    if (stem && key === 'area') {
      const t1 = q.id.slice('area:'.length);
      const area = text(table.needs, t1) ?? displayOf(t1);
      stem = stem.replace('{area}', () => area);
    }
    return {
      ...q,
      stem: stem ?? q.stem,
      options: q.options.map((o) => option(q, o)),
    };
  };

  return { ...clarification, questions: clarification.questions.map(question) };
}
