import { SUNE_TIER1, SUNE_TIER2 } from './sune-v1-needs';

/** The words a need shows: the short name on the button and the spoken description under it (ADR 0039 Decision 31). */
export interface NeedText {
  display: string;
  description: string;
}

export interface NeedTextContext {
  tenantId?: string;
  locale?: string;
}

/**
 * Override seam. ISS-2665 (per-tenant need names) and locales plug in here.
 * Return null (or undefined fields) to fall back to the SUNE default. No
 * storage exists yet: nothing registers a provider in production.
 */
export type NeedTextOverride = (
  code: string,
  ctx: NeedTextContext,
) => Partial<NeedText> | null | undefined;

const DEFAULTS = new Map<string, NeedText>();
for (const e of [...SUNE_TIER1, ...SUNE_TIER2])
  DEFAULTS.set(e.code, { display: e.display, description: e.description });

let override: NeedTextOverride | null = null;

/** Set (or clear with null) the process-wide override provider. */
export const setNeedTextOverride = (fn: NeedTextOverride | null): void => {
  override = fn;
};

const isEnglish = (locale: string | undefined): boolean =>
  !locale || /^en(?:$|[-_,;])/i.test(locale.trim());

/**
 * The text of one need for a tenant and locale: the override when it gives
 * one, else the SUNE default. An unknown code gets the code as display and an
 * empty description. The SUNE descriptions are English: another locale gets none
 * until an override has it. `provider` lets a caller or test pass an override
 * without touching the process-wide one.
 */
export function needText(
  code: string,
  ctx: NeedTextContext = {},
  provider: NeedTextOverride | null = override,
): NeedText {
  const base = DEFAULTS.get(code) ?? { display: code, description: '' };
  const o = provider?.(code, ctx);
  return {
    display: o?.display?.trim() ? o.display : base.display,
    description: o?.description?.trim()
      ? o.description
      : isEnglish(ctx.locale)
        ? base.description
        : '',
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
