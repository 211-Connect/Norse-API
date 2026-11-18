import { emergencyBand } from './bands';
import { CUTOFFS } from './config';
import { scoreOf } from './scores';
import { NX } from './sune';
import { AiClassificationSetting, RulesRequest, RulesSignals } from './types';

/**
 * Weak match (ISS-2796, signal D; Lucas 2026-11-18): the text found nothing
 * the three judges trust. All rules must hold:
 * 1. There is text and AI classification is on.
 * 2. The need model answered (an error or timeout is never weak).
 * 3. The emergency check is calm: no popup band, no failed check, no keyword
 *    floor hit, no caller U-0. The soft band can be weak (its card still shows).
 * 4. Keyword judge K < keywordBelow. K is 0 when the text has no content word.
 * 5. Need judge N < needBelow: best need score, N-X left out, missing = 0.
 * 6. Vector judge V < vectorBelow.
 * 7. The judges are known. Without them (the search did not take the fused
 *    path) the query is never weak.
 */
export function isWeakMatch(input: {
  req: RulesRequest;
  signals: RulesSignals;
  ai: AiClassificationSetting;
  judges: { keyword_top: number; vector_top: number } | null;
  has_content_word_raw: boolean;
}): boolean {
  const { req, signals, ai, judges, has_content_word_raw } = input;
  const cut = CUTOFFS.weakMatch;
  if (!req.has_text || ai !== 'on') return false;
  if (signals.needs.status !== 'ok') return false;
  // Signal D as measured: the popup band, a floor hit or a failed check
  // protects the text. The soft band does not: its card still shows next to
  // the empty results (Lucas 2026-11-17: "help" is nonsense).
  const band = emergencyBand(signals.emergency);
  if (
    band === 'popup' ||
    band === 'unknown' ||
    signals.emergency?.floor_hit === true ||
    req.urgency === 'U-0'
  ) {
    return false;
  }
  if (!judges) return false;

  const keyword = has_content_word_raw ? judges.keyword_top : 0;
  if (!(keyword < cut.keywordBelow)) return false;

  const scores = signals.needs.scores ?? {};
  let need = 0;
  for (const code of Object.keys(scores)) {
    if (code !== NX) need = Math.max(need, scoreOf(scores, code));
  }
  if (!(need < cut.needBelow)) return false;

  return judges.vector_top < cut.vectorBelow;
}
