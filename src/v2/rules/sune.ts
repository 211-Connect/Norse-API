import { SUNE_TIER1, SUNE_TIER2 } from './sune-v1-needs';

const sune = { tier1: SUNE_TIER1, tier2: SUNE_TIER2 };

export const NX = 'N-X';

const TIER1 = sune.tier1.map((e) => e.code);
const TIER2 = sune.tier2.map((e) => e.code);
const TIER1_SET = new Set(TIER1);
const TIER2_SET = new Set(TIER2);
const DISPLAY = new Map<string, string>();
const PARENT = new Map<string, string>();
for (const e of [...sune.tier1, ...sune.tier2]) DISPLAY.set(e.code, e.display);
for (const e of sune.tier2) PARENT.set(e.code, e.tier1);

export const allTier1 = (): string[] => [...TIER1];
export const allTier2 = (): string[] => [...TIER2];
export const isTier1 = (code: string): boolean => TIER1_SET.has(code);
export const isTier2 = (code: string): boolean => TIER2_SET.has(code);
export const isKnownCode = (code: string): boolean =>
  isTier1(code) || isTier2(code) || code === NX;
export const tier1Of = (code: string): string | null =>
  isTier1(code) ? code : (PARENT.get(code) ?? null);
export const childrenOf = (tier1: string): string[] =>
  TIER2.filter((c) => PARENT.get(c) === tier1);
export const displayOf = (code: string): string =>
  code === NX
    ? 'A specific place or organization'
    : (DISPLAY.get(code) ?? code);
