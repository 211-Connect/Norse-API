import { SUNE_TIER1, SUNE_TIER2 } from './sune-v1-needs';

/** Internal code: "need not yet known". Never an option, never accepted in `needs` (ISS-2499). */
export const NX = 'N-X';

export const TIER1_CODES: readonly string[] = SUNE_TIER1.map((e) => e.code);
export const TIER2_CODES: readonly string[] = SUNE_TIER2.map((e) => e.code);
const TIER1_SET = new Set(TIER1_CODES);
const TIER2_SET = new Set(TIER2_CODES);
const DISPLAY = new Map<string, string>();
const PARENT = new Map<string, string>();
for (const e of [...SUNE_TIER1, ...SUNE_TIER2]) DISPLAY.set(e.code, e.display);
for (const e of SUNE_TIER2) PARENT.set(e.code, e.tier1);

export const isTier1 = (code: string): boolean => TIER1_SET.has(code);
export const isTier2 = (code: string): boolean => TIER2_SET.has(code);
export const isKnownCode = (code: string): boolean =>
  isTier1(code) || isTier2(code) || code === NX;
export const tier1Of = (code: string): string | null =>
  isTier1(code) ? code : (PARENT.get(code) ?? null);
export const childrenOf = (tier1: string): string[] =>
  TIER2_CODES.filter((c) => PARENT.get(c) === tier1);
export const displayOf = (code: string): string => DISPLAY.get(code) ?? code;
/** A question's need options, without N-X. */
export const needOptions = <T extends { value: string }>(
  options: readonly T[],
): T[] => options.filter((o) => o.value !== NX);
