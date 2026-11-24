import { queryWords } from '../../search/internal/text-matching/query-words';

/** What the returned hits say about the query words (the grid's second measure). */
export type Match = 'concentrated' | 'spread' | 'none';

export const MATCH = {
  // Per query word: the share of hits that hold it (see `wordsHeld`).
  textShareMin: 0.2,
  topN: 20,
  // A name test: the share of the name head the query words cover.
  nameBackMin: 0.6,
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
  // Different org names that must agree when none starts with the query words
  // (decided 2026-11-24: one 'Ballard Food Bank' does not make 'food bank' a name).
  nonStartNamesMin: 2,
  // Different orgs read from the keyword list ('dshs' WA is org 7).
  nameOrgs: 10,
  // Shortest word that is checked for a typo.
  typoMinLength: 5,
};

/** `text` = name + description + summary + taxonomy names, lowercased. */
export interface MatchHit {
  org_name: string | null;
  text: string;
}

const FUNCTION_WORDS = new Set(['the', 'of', 'and', 'for', 'a', 'an', 'in']);

// The query words come from the same split: accents folded, apostrophes dropped.
const toks = queryWords;

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

/** Every query word is a word, or the start of one, of the text. */
export function holdsAllWords(words: string[], text: string): boolean {
  const qt = queryTokens(words);
  const ts = toks(text);
  return qt.length > 0 && qt.every((t) => tokHit(t, ts));
}

const NAME_FUNCTION = new Set([
  ...FUNCTION_WORDS,
  'inc',
  'llc',
  'at',
  'to',
  'on',
]);

const NAME_SEP = /,|\s[-\u2013]\s|'s\s|\sof\s|\(|:|\sat\s|\sserving\s|\//i;

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
  if (!holdsAllWords(qt, name)) return false;
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
 * The candidates the query names, or null. A name that starts with the query
 * words counts (`start`); otherwise at least `nonStartNamesMin` different names
 * that share their first head word ('red cross': two American Red Cross regions).
 */
export function nameMatch(
  words: string[],
  candidates: NameCandidate[],
): { start: boolean; org_ids: string[] } | null {
  const qt = queryTokens(words);
  if (qt.length === 0) return null;
  const start: string[] = [];
  const other: { id: string; name: string; first: string }[] = [];
  for (const c of candidates) {
    const names = [c.name, ...c.alternate_names];
    if (names.some((n) => nameFits(qt, n, true))) {
      start.push(c.id);
      continue;
    }
    const name = names.find((n) => nameFits(qt, n, false));
    if (name !== undefined)
      other.push({ id: c.id, name, first: nameHead(name)[0] });
  }
  if (start.length > 0) return { start: true, org_ids: start };
  const different = new Set(other.map((x) => x.name.toLowerCase())).size;
  return different >= MATCH.nonStartNamesMin &&
    other.every((x) => x.first === other[0].first)
    ? { start: false, org_ids: other.map((x) => x.id) }
    : null;
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

/** Many hits hold the words but few have them in the org name: a common word, not a name. */
export function genericName(words: string[], hits: MatchHit[]): boolean {
  const qt = queryTokens(words);
  if (qt.length === 0) return false;
  const holders = hits.filter((h) => {
    const xt = new Set(toks(h.text));
    return qt.every((t) => holdsWord(t, xt));
  });
  const inName = holders.filter((h) => holdsAllWords(words, h.org_name ?? ''));
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

/**
 * `named`: the keyword list names an org and no veto took the claim. No query
 * tokens or no hits is no claim about the query (browse): `spread`.
 */
export function matchOf(i: {
  words: string[];
  hits: MatchHit[];
  named: boolean;
}): Match {
  return matchValue({
    words: i.words,
    hit_count: i.hits.length,
    words_held: wordsHeld(wordCoverage(i.words, i.hits)),
    named: i.named,
  });
}

/** The match value from saved measures (the judge spec reads these). */
export function matchValue(i: {
  words: string[];
  hit_count: number;
  words_held: boolean;
  named: boolean;
}): Match {
  if (queryTokens(i.words).length === 0) return 'spread';
  // The claim is about the query: a page past the last hit keeps it.
  if (i.named) return 'concentrated';
  if (i.hit_count === 0) return 'spread';
  return i.words_held ? 'spread' : 'none';
}
