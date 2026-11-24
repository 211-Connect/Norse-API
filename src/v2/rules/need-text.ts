import { matchLocale } from '../../common/locales';
import { SUNE_TIER1, SUNE_TIER2 } from './sune-v1-needs';

/** The words a need shows: the short name on the button and the spoken description under it (ADR 0039 Decision 31). */
export interface NeedText {
  display: string;
  description: string;
}

export interface NeedTextContext {
  locale?: string;
}

const DEFAULTS = new Map<string, NeedText>();
for (const e of [...SUNE_TIER1, ...SUNE_TIER2])
  DEFAULTS.set(e.code, { display: e.display, description: e.description });

const isEnglish = (locale: string | undefined): boolean =>
  !locale || matchLocale(locale, (tag) => tag === 'en' || undefined) === true;

/**
 * The text of one need for a locale: the SUNE default. An unknown code gets the
 * code as display and an empty description. The SUNE descriptions are English:
 * another locale gets none.
 */
export function needText(code: string, ctx: NeedTextContext = {}): NeedText {
  const base = DEFAULTS.get(code) ?? { display: code, description: '' };
  return {
    display: base.display,
    description: isEnglish(ctx.locale) ? base.description : '',
  };
}

/** The description field of a need option or intent; absent when there is no text. */
export function needDescription(
  code: string,
  ctx: NeedTextContext,
): { description?: string } {
  const { description } = needText(code, ctx);
  return description ? { description } : {};
}
