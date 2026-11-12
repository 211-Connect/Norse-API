import { NX } from './sune';
import { Question, QuestionImportance, RulesSignals } from './types';

export const BAND_BASE: Record<QuestionImportance, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, x));

export const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function yesNo(p: number): number {
  const c = clamp(p, 0, 1);
  return 4 * c * (1 - c);
}

export function normEntropy(ps: number[]): number {
  const v = ps.filter((x) => Number.isFinite(x)).map((x) => Math.max(0, x));
  if (v.length < 2) return 0;
  const sum = v.reduce((a, b) => a + b, 0);
  if (sum === 0) return 1;
  let h = 0;
  for (const x of v) {
    const qn = x / sum;
    if (qn > 0) h -= qn * Math.log(qn);
  }
  return clamp(h / Math.log(v.length), 0, 1);
}

const needScores = (q: Question, scores: Record<string, number>): number[] =>
  q.options.filter((o) => o.value !== NX).map((o) => scores[o.value] ?? 0);

/** Uncertainty of a needs question over the options it has now. */
export function needUncertainty(
  q: Question,
  scores: Record<string, number>,
): number {
  if (q.type === 'find_need') return normEntropy(needScores(q, scores));
  if (q.type === 'narrow') {
    const ys = needScores(q, scores).map(yesNo);
    return ys.length === 0 ? 0 : ys.reduce((a, b) => a + b, 0) / ys.length;
  }
  return 0;
}

export function uncertainty(q: Question, signals: RulesSignals): number {
  if (q.id === 'emergency') {
    const e = signals.emergency;
    const s =
      e && e.status === 'ok' && typeof e.score === 'number' ? e.score : 0.5;
    return yesNo(s);
  }
  if (q.id === 'urgency_today' || q.id === 'urgency_time') {
    return yesNo(signals.needs.urgency?.score ?? 0.5);
  }
  return needUncertainty(q, signals.needs.scores ?? {});
}

export function effort(q: Question): number {
  return clamp(1 - 0.05 * (q.options.length - 2), 0.8, 1);
}

export function splitQuality(q: Question, total: number): number {
  const counts = q.options
    .map((o) => o.resultsCount)
    .filter((n): n is number => typeof n === 'number');
  if (counts.length === 0 || total <= 0) return 1;
  if (counts.length === 1) {
    return clamp(1 - 2 * Math.abs(counts[0] / total - 0.5), 0, 1);
  }
  return normEntropy(counts);
}

export const valueOf = (u: number, e: number, s: number): number =>
  Math.min(0.999, round3(u * e * s));

export const priorityOf = (
  importance: QuestionImportance,
  value: number,
): number => round3(BAND_BASE[importance] + value);
