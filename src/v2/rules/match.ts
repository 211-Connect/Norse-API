/** What the returned hits say about the query words (the grid's second measure). */
export type Match = 'concentrated' | 'spread' | 'none';

export const MATCH = {
  orgShareMin: 0.5,
  // Per query word: the share of hits that hold it (see `wordsHeld`).
  textShareMin: 0.2,
  // One org holds the query words in at least this share of the top 20
  // (measured 2026-11-23 on WA_211, IL211, Rochester NY: idf did not separate
  // names from common words; one-org concentration did).
  topOrgShareMin: 0.45,
  topN: 20,
  // A name test: the share of the name head the query words cover.
  nameBackMin: 0.6,
  // The top org's name head must be covered this much by the query words.
  topOrgBackMin: 0.5,
  // A word is generic when at least this many hits hold it and fewer than
  // `genericNameShareMax` of those have it in the org name.
  genericMinHolders: 5,
  genericNameShareMax: 0.5,
  // A taxonomy term is the query phrase when the query covers this much of it
  // (offline 2026-11-24: 0.5 to 0.75 lose no held name, 0.4 loses 'red cross').
  topicTermMin: 0.6,
  // A query with at least this many words needs `longHeldShareMin` of its
  // words held (each by `textShareMin` of the hits); a shorter one every word.
  longQueryMinWords: 3,
  longHeldShareMin: 0.5,
  // Candidates the name lookup asks for.
  nameLookupSize: 5,
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

export const queryTokens = (words: string[]): string[] =>
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

const NAME_FUNCTION = new Set([
  ...FUNCTION_WORDS,
  'inc',
  'llc',
  'at',
  'to',
  'on',
]);

const NAME_SEP = /,|\s[-\u2013]\s|'s\s|\sof\s|\(|:|\sat\s|\//i;

/** The leading part of an org name, without function words, in order. */
export function nameHead(name: string): string[] {
  const head = toks(name.split(NAME_SEP)[0]).filter(
    (w) => !NAME_FUNCTION.has(w),
  );
  return head.filter((w, i) => head.indexOf(w) === i);
}

const headWordHit = (w: string, t: string): boolean =>
  w === t ||
  w === t + 's' ||
  t === w + 's' ||
  (t.length >= 5 && w.startsWith(t));

/** Lowercased all-caps tokens of 3+ letters ('DSHS'); none when the whole name is caps. */
export function capsTokens(name: string): string[] {
  if (name.toUpperCase() === name) return [];
  return (name.match(/\b[A-Z]{3,}\b/g) ?? []).map((w) => w.toLowerCase());
}

function nameFits(qt: string[], name: string, prefix: boolean): boolean {
  if (qt.length === 1 && capsTokens(name).includes(qt[0])) return true;
  const nt = toks(name);
  if (!qt.every((t) => tokHit(t, nt))) return false;
  const head = nameHead(name);
  if (head.length === 0) return false;
  const covered = head.filter((w) => qt.some((t) => headWordHit(w, t)));
  if (covered.length / head.length < MATCH.nameBackMin) return false;
  return !prefix || covered.includes(head[0]);
}

export interface NameCandidate {
  id: string;
  name: string;
  alternate_names: string[];
}

/**
 * Does the query name an org? A candidate whose name starts with the query
 * words counts; otherwise several candidates count when they share their first
 * head word ('red cross': two American Red Cross regions).
 */
export function nameMatch(
  words: string[],
  candidates: NameCandidate[],
): { named: boolean; org_ids: string[]; name: string | null } {
  const qt = queryTokens(words);
  const none = { named: false, org_ids: [] as string[], name: null };
  if (qt.length === 0) return none;
  const prefix: { id: string; name: string }[] = [];
  const other: { id: string; name: string; first: string }[] = [];
  for (const c of candidates) {
    const names = [c.name, ...c.alternate_names];
    const p = names.find((n) => nameFits(qt, n, true));
    if (p !== undefined) {
      prefix.push({ id: c.id, name: p });
      continue;
    }
    const o = names.find((n) => nameFits(qt, n, false));
    if (o !== undefined)
      other.push({ id: c.id, name: o, first: nameHead(o)[0] });
  }
  if (prefix.length > 0) {
    return {
      named: true,
      org_ids: prefix.map((x) => x.id),
      name: prefix[0].name,
    };
  }
  if (other.length > 0 && other.every((x) => x.first === other[0].first)) {
    return {
      named: true,
      org_ids: other.map((x) => x.id),
      name: other[0].name,
    };
  }
  return none;
}

/** Damerau-Levenshtein distance of at most 1 (insert, delete, substitute, adjacent swap). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const d: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i);
    return (
      d.length === 1 ||
      (d.length === 2 &&
        d[1] === d[0] + 1 &&
        a[d[0]] === b[d[1]] &&
        a[d[1]] === b[d[0]])
    );
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

/** The stem rule, or (5+ letters) a one-edit typo of a word of 4+ letters. */
function holdsWord(t: string, words: Set<string>): boolean {
  const stem = t.slice(0, Math.max(4, t.length - 2));
  for (const w of words) {
    if (w === t || (t.length >= 4 && w.startsWith(stem))) return true;
  }
  if (t.length >= 5) {
    for (const w of words) {
      if (w.length >= 4 && withinOneEdit(t, w)) return true;
    }
  }
  return false;
}

/** Per query token, the share of hits whose text holds it. */
export function wordCoverage(words: string[], hits: MatchHit[]): number[] {
  const qt = queryTokens(words);
  if (qt.length === 0 || hits.length === 0) return [];
  const sets = hits.map((h) => new Set(toks(h.text)));
  return qt.map(
    (t) => sets.filter((ws) => holdsWord(t, ws)).length / hits.length,
  );
}

/** The hits hold the query words (a short query: every word; a long one: half of them). */
export function wordsHeld(cov: number[]): boolean {
  if (cov.length === 0) return true;
  if (cov.length < MATCH.longQueryMinWords) {
    return Math.min(...cov) >= MATCH.textShareMin;
  }
  const held = cov.filter((c) => c >= MATCH.textShareMin).length;
  return held / cov.length >= MATCH.longHeldShareMin;
}

/** Share of hits whose text holds every query word (telemetry). */
export function textShare(words: string[], hits: MatchHit[]): number {
  const qt = queryTokens(words);
  if (qt.length === 0) return 0;
  const n = hits.filter((h) => {
    const xt = new Set(toks(h.text));
    return qt.every((t) => holdsWord(t, xt));
  }).length;
  return n / Math.max(1, hits.length);
}

/** Many hits hold the words but few have them in the org name: a common word, not a name. */
export function genericName(words: string[], hits: MatchHit[]): boolean {
  const qt = queryTokens(words);
  if (qt.length === 0) return false;
  const holders = hits.filter((h) => {
    const xt = new Set(toks(h.text));
    return qt.every((t) => holdsWord(t, xt));
  });
  const inName = holders.filter((h) => {
    const nt = toks(h.org_name ?? '');
    return qt.every((t) => tokHit(t, nt));
  });
  return (
    holders.length >= MATCH.genericMinHolders &&
    inName.length / holders.length < MATCH.genericNameShareMax
  );
}

const topicWordHit = (t: string, w: string): boolean =>
  w === t ||
  (t.length >= 4 &&
    Math.abs(w.length - t.length) <= 3 &&
    w.startsWith(t.slice(0, Math.max(4, t.length - 2))));

/**
 * Is the query a topic the directory itself has a term for ('food bank',
 * 'housing authority')? A term holds every query word, and the query words
 * cover most of the term. A '/' or '*' splits a term ('Food Banks/Food
 * Distribution Warehouses'). No word list: the terms come from the hits.
 */
export function topicPhrase(words: string[], terms: string[]): boolean {
  const qt = queryTokens(words);
  if (qt.length === 0) return false;
  return terms.some((term) =>
    term.split(/[/*]/).some((part) => {
      const tw = toks(part).filter((w) => !NAME_FUNCTION.has(w));
      if (!qt.every((t) => tw.some((w) => topicWordHit(t, w)))) return false;
      const covered = tw.filter((w) => qt.some((t) => topicWordHit(t, w)));
      return covered.length / tw.length >= MATCH.topicTermMin;
    }),
  );
}

/** How much of the top org's name head the query words cover. */
export function topOrgBack(words: string[], hits: MatchHit[]): number {
  const qt = queryTokens(words);
  if (qt.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const h of hits) {
    if (h.org_name && orgMatch(qt, h.org_name)) {
      counts.set(h.org_name, (counts.get(h.org_name) ?? 0) + 1);
    }
  }
  let top: string | null = null;
  let best = 0;
  for (const [name, n] of counts) {
    if (n > best) {
      best = n;
      top = name;
    }
  }
  if (top === null) return 0;
  if (qt.length === 1 && capsTokens(top).includes(qt[0])) return 1;
  const head = nameHead(top);
  if (head.length === 0) return 0;
  const covered = head.filter((w) => qt.some((t) => headWordHit(w, t)));
  return covered.length / head.length;
}

/** The match value from shares already computed (the judge spec reads saved shares). */
export function matchFromShares(i: {
  words: string[];
  hit_count: number;
  org_share: number;
  top_org_share: number;
  top_org_back: number;
  text_share: number;
  words_held: boolean;
  named: boolean;
  generic: boolean;
}): Match {
  // No query tokens or no hits: no claim about the query; browse.
  if (queryTokens(i.words).length === 0 || i.hit_count === 0) return 'spread';
  if (i.named && !i.generic) return 'concentrated';
  if (
    i.org_share >= MATCH.orgShareMin &&
    i.top_org_share >= MATCH.topOrgShareMin &&
    i.top_org_back >= MATCH.topOrgBackMin
  ) {
    return 'concentrated';
  }
  return i.words_held ? 'spread' : 'none';
}

export function matchOf(i: {
  words: string[];
  hits: MatchHit[];
  names?: NameCandidate[] | null;
}): {
  value: Match;
  org_share: number;
  text_share: number;
  top_org_share: number;
  top_org_back: number;
  words_held: boolean;
  named: boolean;
  generic: boolean;
  named_org_ids: string[];
} {
  const org_share = orgShare(i.words, i.hits);
  const text_share = textShare(i.words, i.hits);
  const top_org_share = topOrgShare(i.words, i.hits);
  const top_org_back = topOrgBack(i.words, i.hits);
  const words_held = wordsHeld(wordCoverage(i.words, i.hits));
  const generic = genericName(i.words, i.hits);
  const nm = i.names ? nameMatch(i.words, i.names) : null;
  const named = nm?.named ?? false;
  const value = matchFromShares({
    words: i.words,
    hit_count: i.hits.length,
    org_share,
    top_org_share,
    top_org_back,
    text_share,
    words_held,
    named,
    generic,
  });
  const decidedByName = named && !generic && value === 'concentrated';
  return {
    value,
    org_share,
    text_share,
    top_org_share,
    top_org_back,
    words_held,
    named,
    generic,
    named_org_ids: decidedByName && nm ? nm.org_ids : [],
  };
}

/**
 * The match value when a name owner already decided the name claim. Reads the
 * name only: no org shares, no name test, no generic test (`vetoed` is it).
 */
export function matchFromName(i: {
  words: string[];
  hits: MatchHit[];
  name: {
    strength: 'org' | 'service' | 'none';
    vetoed: boolean;
    out_of_radius: boolean | null;
  };
}): ReturnType<typeof matchOf> {
  const words_held = wordsHeld(wordCoverage(i.words, i.hits));
  const text_share = textShare(i.words, i.hits);
  const { strength, vetoed, out_of_radius } = i.name;
  const value: Match =
    queryTokens(i.words).length === 0 || i.hits.length === 0
      ? 'spread'
      : strength === 'org' && !vetoed && out_of_radius !== true
        ? 'concentrated'
        : words_held
          ? 'spread'
          : 'none';
  return {
    value,
    org_share: 0,
    text_share,
    top_org_share: 0,
    top_org_back: 0,
    words_held,
    named: strength === 'org',
    generic: vetoed,
    named_org_ids: [],
  };
}
