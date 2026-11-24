import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { fuzzyFallbackFor } from '../text-matching/fuzzy-match';
import { hitText, taxonomyNames } from '../text-matching/hit-text';
import { queryWords } from '../text-matching/query-words';
import {
  holdsAllWords,
  holdsWord,
  queryTokens,
  withinOneEdit,
} from '../text-matching/word-match';

/**
 * Does the query name an org? The keyword list answers (question rule v1): its
 * hits already hold the org names and passed the request's filters (radius,
 * area, cutoff), so a named org is inside them on every sort and no other read
 * is needed.
 */

const NAME = {
  // The share of the name head the query words cover.
  headCoverMin: 0.6,
  // Different org names that must agree when none starts with the query words
  // (decided 2026-11-24: one 'Ballard Food Bank' does not make 'food bank' a name).
  nonStartNamesMin: 2,
  // Different orgs read from the keyword list ('dshs' WA is org 7).
  orgs: 10,
  // The fused top hits the common-word check reads.
  topN: 20,
  // A word is generic when at least this many hits hold it and fewer than
  // `genericNameShareMax` of those have it in the org name.
  genericMinHolders: 5,
  genericNameShareMax: 0.5,
  // A taxonomy term is the query phrase when the query covers this much of it
  // (offline 2026-11-24: 0.5 to 0.75 lose no held name, 0.4 loses 'red cross').
  topicTermMin: 0.6,
  // Shortest word that is checked for a typo.
  typoMinLength: 5,
};

/** What the keyword list returns per hit for the name match. */
export const NAME_SOURCE = [
  'name',
  'description',
  'summary',
  'taxonomies.name',
  'organization.id',
  'organization.name',
  'organization.alternate_name',
];

/** Most services of the named org(s) that lead the relevance order. */
export const NAMED_ORG_PIN_MAX = 3;

export type NameHit = {
  id: string;
  text: string;
  org_id: string | null;
  org_name: string | null;
  alternate_names: string[];
  service_name: string;
  taxonomy_names: string[];
};

/** `failed`: no list, or only a part of it. `skipped`: the keyword leg is off. */
export type NameHits = {
  state: 'ok' | 'failed' | 'skipped';
  hits: NameHit[];
};

export type NameClaim = {
  /** `failed` is not "no org named": the answer is not stored. */
  status: 'ok' | 'failed';
  /** The named orgs; empty when none is named or a veto took the claim. */
  org_ids: string[];
  /** Why a claim was dropped: a common word, or a topic of the directory. */
  veto: 'generic' | 'topic' | null;
  /** The ids that lead a relevance order, in the fused order. */
  pins: string[];
};

export function nameHit(id: string, source: unknown): NameHit {
  const src = (source ?? {}) as Record<string, unknown>;
  const org = (src.organization ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return {
    id,
    text: hitText(source),
    org_id: str(org.id),
    org_name: str(org.name),
    alternate_names: alternateNames(org.alternate_name),
    service_name: (str(src.name) ?? '').replace(/\s+/g, ' '),
    taxonomy_names: taxonomyNames(src),
  };
}

/** An org's alternate names: one string with ';' between names, or a list. */
export function alternateNames(alt: unknown): string[] {
  const list =
    typeof alt === 'string' ? alt.split(';') : Array.isArray(alt) ? alt : [];
  return list
    .filter((a): a is string => typeof a === 'string')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/**
 * One more keyword clause that finds an org by a name with one typo per word.
 * Only for a query with a word that the tenant's searched text does not hold
 * (`unknownWords`), so a query of known words keeps its list. Its boost is the
 * typo fallback's: far under the weak-match cutoff on the list's top score.
 */
export function nameTypoClauses(
  text: string,
  unknownWords: string[],
): QueryDslQueryContainer[] {
  if (unknownWords.length === 0) return [];
  const fuzzy = fuzzyFallbackFor({
    multi_match: {
      query: text,
      operator: 'and',
      fields: ['organization.name'],
    },
  });
  // One edit, the same as `fixTypos`: with two, 'worksource' finds 'Workforce'.
  return [{ multi_match: { ...fuzzy.multi_match!, fuzziness: 1 } }];
}

/** Unknown words one edit away from a word of the org names, put right. */
function fixTypos(
  words: string[],
  unknownWords: string[],
  names: string[],
): string[] {
  const known = queryWords(names.join(' '));
  return words.map((w) =>
    w.length >= NAME.typoMinLength &&
    unknownWords.includes(w) &&
    !known.includes(w)
      ? (known.find((k) => k.length >= 4 && withinOneEdit(w, k)) ?? w)
      : w,
  );
}

const NAME_FUNCTION = new Set([
  'the',
  'of',
  'and',
  'for',
  'a',
  'an',
  'in',
  'inc',
  'llc',
  'at',
  'to',
  'on',
]);

const NAME_SEP = /,|\s[-\u2013]\s|['’]s\s|\sof\s|\(|:|\sat\s|\//i;

/** The leading part of an org name, without function words, in order. */
export function nameHead(name: string): string[] {
  const head = queryWords(name.split(NAME_SEP)[0]).filter(
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
  if (covered.length / head.length < NAME.headCoverMin) return false;
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
  return different >= NAME.nonStartNamesMin &&
    other.every((x) => x.first === other[0].first)
    ? { start: false, org_ids: other.map((x) => x.id) }
    : null;
}

/** Many hits hold the words but few have them in the org name: a common word, not a name. */
export function genericName(words: string[], hits: NameHit[]): boolean {
  const qt = queryTokens(words);
  if (qt.length === 0) return false;
  const holders = hits.filter((h) => {
    const xt = new Set(queryWords(h.text));
    return qt.every((t) => holdsWord(t, xt));
  });
  const inName = holders.filter((h) => holdsAllWords(words, h.org_name ?? ''));
  return (
    holders.length >= NAME.genericMinHolders &&
    inName.length / holders.length < NAME.genericNameShareMax
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
      const tw = queryWords(part).filter((w) => !NAME_FUNCTION.has(w));
      if (!qt.every((t) => tw.some((w) => topicWordHit(t, w)))) return false;
      const covered = tw.filter((w) => qt.some((t) => topicWordHit(t, w)));
      return covered.length / tw.length >= NAME.topicTermMin;
    }),
  );
}

/** A service name's trailing ' offered by/at ...', ' at ...' or ' | ...'. */
const SERVICE_SUFFIX = /\s+offered\s+(?:by|at)\s.*$|\s+at\s.*$|\s+\|.*$/i;

/** An org without the words in its name has a service with them in its name. */
const offeredByOthers = (words: string[], hits: NameHit[]): boolean =>
  hits.some(
    (h) =>
      h.org_name !== null &&
      !holdsAllWords(words, h.org_name) &&
      holdsAllWords(words, h.service_name.replace(SERVICE_SUFFIX, '')),
  );

/**
 * The org(s) the query names, read from the keyword list.
 *
 * A name that starts with the query words is a claim. A name that only holds
 * them ('Ballard Food Bank' for 'food bank') may be a place plus a topic, so
 * it needs two different names that agree ('red cross') and no other org that
 * offers a service by these words. Without a claim the ranking and the
 * questions stay as they are. A claim is dropped when the words are a topic of
 * the directory or a common word in the top hits.
 */
export function claimName(i: {
  words: string[];
  list: NameHits;
  /** Null: the word counts failed, so a typo cannot be told from a name. */
  unknownWords: string[] | null;
  /** The fused order; undefined: the keyword order stands in. */
  fusedIds: string[] | undefined;
}): NameClaim {
  const none: NameClaim = { status: 'ok', org_ids: [], veto: null, pins: [] };
  const { hits, state } = i.list;
  if (state !== 'ok') {
    return { ...none, status: state === 'failed' ? 'failed' : 'ok' };
  }
  const orgs = new Map<string, NameCandidate>();
  for (const h of hits) {
    if (orgs.size >= NAME.orgs) break;
    if (h.org_id && h.org_name && !orgs.has(h.org_id)) {
      orgs.set(h.org_id, {
        id: h.org_id,
        name: h.org_name,
        alternate_names: h.alternate_names,
      });
    }
  }
  const candidates = [...orgs.values()];
  let words = i.words;
  let named = nameMatch(words, candidates);
  if (!named && i.unknownWords === null) return { ...none, status: 'failed' };
  if (!named && i.unknownWords && i.unknownWords.length > 0) {
    words = fixTypos(
      i.words,
      i.unknownWords,
      candidates.flatMap((c) => [c.name, ...c.alternate_names]),
    );
    named = nameMatch(words, candidates);
  }
  if (!named || (!named.start && offeredByOthers(words, hits))) return none;

  if (
    topicPhrase(
      words,
      hits.flatMap((h) => h.taxonomy_names),
    )
  ) {
    return { ...none, veto: 'topic' };
  }
  const byId = new Map(hits.map((h) => [h.id, h]));
  const order = i.fusedIds ?? hits.map((h) => h.id);
  const top = order.slice(0, NAME.topN).flatMap((id) => byId.get(id) ?? []);
  if (genericName(words, top)) return { ...none, veto: 'generic' };

  const ids = new Set(named.org_ids);
  const own = (id: string) => ids.has(byId.get(id)?.org_id ?? '');
  const rest = hits.map((h) => h.id).filter((id) => !order.includes(id));
  return {
    ...none,
    org_ids: named.org_ids,
    pins: [...order, ...rest].filter(own).slice(0, NAMED_ORG_PIN_MAX),
  };
}

/** The query words a name match reads; empty: there is no name to look for. */
export const nameWords = (words: string[]): string[] =>
  queryTokens(words).length > 0 ? words : [];
