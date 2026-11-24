import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { fuzzyFallbackFor } from '../../search/internal/text-matching/fuzzy-match';
import {
  MATCH,
  MatchHit,
  NameCandidate,
  genericName,
  holdsAllWords,
  nameMatch,
  queryTokens,
  topicPhrase,
  withinOneEdit,
} from '../rules/match';

/**
 * Does the query name an org? The keyword list answers (question rule v1): its
 * hits already hold the org names and passed the request's filters (radius,
 * area, cutoff), so a named org is inside them on every sort and no other read
 * is needed.
 */

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

export type NameHit = MatchHit & {
  id: string;
  org_id: string | null;
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

/** One hit's `_source` as the match check reads it. */
export function matchHit(source: unknown): MatchHit {
  const src = (source ?? {}) as Record<string, unknown>;
  const org = src.organization;
  const orgName =
    typeof org === 'string'
      ? org
      : typeof (org as { name?: unknown } | undefined)?.name === 'string'
        ? (org as { name: string }).name
        : null;
  const text = [
    src.name,
    src.description,
    src.summary,
    ...taxonomyNames(src.taxonomies),
  ]
    .filter((x): x is string => typeof x === 'string')
    .join(' ')
    .toLowerCase();
  return { org_name: orgName, text };
}

export function nameHit(id: string, source: unknown): NameHit {
  const src = (source ?? {}) as Record<string, unknown>;
  const org = (src.organization ?? {}) as {
    id?: unknown;
    alternate_name?: unknown;
  };
  return {
    ...matchHit(source),
    id,
    org_id: typeof org.id === 'string' && org.id !== '' ? org.id : null,
    alternate_names: alternateNames(org.alternate_name),
    service_name: typeof src.name === 'string' ? src.name : '',
    taxonomy_names: taxonomyNames(src.taxonomies),
  };
}

function taxonomyNames(taxonomies: unknown): string[] {
  return (Array.isArray(taxonomies) ? taxonomies : [])
    .map((t) => (t as { name?: unknown } | null)?.name)
    .filter((n): n is string => typeof n === 'string');
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
 * Only for a query with a word no document of the tenant holds (`unknownWords`),
 * so the list of a correctly spelled query does not change. Its boost is the
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
  const known = [
    ...new Set(names.flatMap((n) => n.toLowerCase().match(/[a-z0-9]+/g) ?? [])),
  ];
  return words.map((w) =>
    w.length >= MATCH.typoMinLength && unknownWords.includes(w)
      ? (known.find((k) => k.length >= 4 && withinOneEdit(w, k)) ?? w)
      : w,
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
  unknownWords: string[];
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
    if (orgs.size >= MATCH.nameOrgs) break;
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
  if (!named && i.unknownWords.length > 0) {
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
  const top = order.slice(0, MATCH.topN).flatMap((id) => byId.get(id) ?? []);
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
