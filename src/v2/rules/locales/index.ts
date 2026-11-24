import { am } from './am';
import { es } from './es';
import { ko } from './ko';
import { ru } from './ru';
import { vi } from './vi';
import { zhHans } from './zh-hans';

/** Raw strings of one language. Every key is optional: a missing key falls back to English. */
export interface RawTable {
  stems: Partial<Record<StemKey, string>>;
  /** U-1 .. U-4 */
  urgency: Record<string, string>;
  emergency: Record<'yes' | 'safeToday' | 'safeSoon', string>;
  /** SUNE need code -> display name */
  needs: Record<string, string>;
  /** Words the UI used to hard-code (question contract v2). Optional: a missing key falls back to English. */
  strings?: Partial<Record<UiStringKey, string>>;
}

export type UiStringKey = 'skipToResults' | 'alsoFitOne';

export type StemKey =
  | 'emergency'
  | 'today'
  | 'time'
  | 'start'
  | 'noMatch'
  | 'area'
  | 'narrow'
  | 'narrowAlso'
  | 'notice'
  | 'spread'
  | 'phoneLine';

/**
 * Every non-English string is machine-translated and waits for WA staff.
 * `needs_review` is flipped to `reviewed` by hand, per entry, after review.
 */
export interface Entry {
  text: string;
  status: 'needs_review' | 'reviewed';
}
export type Table = {
  [K in keyof RawTable]: Partial<Record<string, Entry>>;
};

const mark = (o: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(o)
      .filter(([, v]) => typeof v === 'string' && v.length > 0)
      .map(([k, v]) => [k, { text: v as string, status: 'needs_review' }]),
  ) as Record<string, Entry>;

const build = (raw: RawTable): Table => ({
  stems: mark(raw.stems),
  urgency: mark(raw.urgency),
  emergency: mark(raw.emergency),
  needs: mark(raw.needs),
  strings: mark(raw.strings ?? {}),
});

/** Lowercase language code (as `parseExactLanguage` returns it) -> table. English has none. */
export const LOCALE_TABLES: Readonly<Record<string, Table>> = {
  es: build(es),
  vi: build(vi),
  ru: build(ru),
  ko: build(ko),
  am: build(am),
  'zh-hans': build(zhHans),
};
