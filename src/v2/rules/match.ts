/** What the returned hits say about the query words (the grid's second measure). */
export type Match = 'concentrated' | 'spread' | 'none';

export const MATCH = {
  orgShareMin: 0.5,
  textShareMin: 0.1,
  // One org holds the query words in at least this share of the top 20
  // (measured 2026-11-23 on WA_211, IL211, Rochester NY: idf did not separate
  // names from common words; one-org concentration did).
  topOrgShareMin: 0.45,
  topN: 20,
};

/** `text` = name + description + summary + taxonomy names, lowercased. */
export interface MatchHit {
  org_name: string | null;
  text: string;
}

const STOP = new Set([
  'the',
  'of',
  'and',
  'for',
  'a',
  'an',
  'in',
  'inc',
  'center',
  'services',
  'service',
  'program',
  'county',
]);

const FUNCTION_WORDS = new Set(['the', 'of', 'and', 'for', 'a', 'an', 'in']);

const toks = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Words of a request that say nothing about the thing asked for. Hits do not
 * need to hold them ('i need food and housing' is about food and housing).
 */
const REQUEST_WORDS = new Set([
  'i',
  'im',
  'me',
  'my',
  'we',
  'need',
  'needs',
  'help',
  'want',
  'looking',
  'find',
  'get',
  'please',
  'assistance',
  'near',
  'nearby',
  // Stop words: the hits need not hold them either ('i need food and housing').
  'and',
  'or',
  'the',
  'of',
  'for',
  'a',
  'an',
  'in',
  'to',
  'with',
  'at',
  'on',
]);

/** A US ZIP code names a place; the hits need not hold it as text. */
const isZip = (w: string): boolean => /^\d{5}$/.test(w);

const queryTokens = (words: string[]): string[] =>
  words.filter((w) => w.length >= 2 && !REQUEST_WORDS.has(w) && !isZip(w));

const tokHit = (t: string, ts: string[]): boolean =>
  ts.some((n) => n === t || (t.length >= 4 && n.startsWith(t)));

function orgMatch(qt: string[], org: string): boolean {
  const nt = toks(org);
  if (qt.every((t) => tokHit(t, nt))) return true;
  const j = qt.join('');
  const acr = nt
    .filter((t) => !STOP.has(t))
    .map((t) => t[0])
    .join('');
  const acr2 = nt.map((t) => t[0]).join('');
  // Without function words only: 'dshs' = "Department of Social and Health
  // Services" (STOP drops 'services', so `acr` gives 'dsh').
  const acr3 = nt
    .filter((t) => !FUNCTION_WORDS.has(t))
    .map((t) => t[0])
    .join('');
  return j.length >= 2 && (j === acr || j === acr2 || j === acr3);
}

/** Share of hits whose organization name matches the query words. */
export function orgShare(words: string[], hits: MatchHit[]): number {
  const qt = queryTokens(words);
  if (qt.length === 0) return 0;
  const n = hits.filter((h) => h.org_name && orgMatch(qt, h.org_name)).length;
  return n / Math.max(1, hits.length);
}

/** Share of hits held by the one org name that matches the query words most often. */
export function topOrgShare(words: string[], hits: MatchHit[]): number {
  const qt = queryTokens(words);
  if (qt.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const h of hits) {
    if (h.org_name && orgMatch(qt, h.org_name)) {
      counts.set(h.org_name, (counts.get(h.org_name) ?? 0) + 1);
    }
  }
  const top = Math.max(0, ...counts.values());
  return top / Math.max(1, hits.length);
}

/** Share of hits whose text holds every query word (stem tolerance of 2). */
export function textShare(words: string[], hits: MatchHit[]): number {
  const qt = queryTokens(words);
  if (qt.length === 0) return 0;
  const n = hits.filter((h) => {
    const xt = new Set(toks(h.text));
    return qt.every((t) => {
      const stem = t.slice(0, Math.max(4, t.length - 2));
      for (const w of xt) {
        if (w === t || (t.length >= 4 && w.startsWith(stem))) return true;
      }
      return false;
    });
  }).length;
  return n / Math.max(1, hits.length);
}

/** The match value from shares already computed (the judge spec reads saved shares). */
export function matchFromShares(i: {
  words: string[];
  hit_count: number;
  org_share: number;
  top_org_share: number;
  text_share: number;
}): Match {
  // No query tokens or no hits: no claim about the query; browse.
  if (queryTokens(i.words).length === 0 || i.hit_count === 0) return 'spread';
  if (
    i.org_share >= MATCH.orgShareMin &&
    i.top_org_share >= MATCH.topOrgShareMin
  ) {
    return 'concentrated';
  }
  return i.text_share < MATCH.textShareMin ? 'none' : 'spread';
}

export function matchOf(i: { words: string[]; hits: MatchHit[] }): {
  value: Match;
  org_share: number;
  text_share: number;
  top_org_share: number;
} {
  const org_share = orgShare(i.words, i.hits);
  const text_share = textShare(i.words, i.hits);
  const top_org_share = topOrgShare(i.words, i.hits);
  const value = matchFromShares({
    words: i.words,
    hit_count: i.hits.length,
    org_share,
    top_org_share,
    text_share,
  });
  return { value, org_share, text_share, top_org_share };
}
