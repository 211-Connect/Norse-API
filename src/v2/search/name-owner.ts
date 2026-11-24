import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { fuzzyFallbackFor } from '../../search/internal/text-matching/fuzzy-match';
import {
  MATCH,
  MatchHit,
  NameCandidate,
  genericName,
  nameMatch,
  queryTokens,
  withinOneEdit,
  wordCoverage,
} from '../rules/match';
import { alternateNames } from './name-lookup.service';

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
  const taxonomies = Array.isArray(src.taxonomies)
    ? (src.taxonomies as { name?: unknown }[]).map((t) => t?.name)
    : [];
  const text = [src.name, src.description, src.summary, ...taxonomies]
    .filter((x): x is string => typeof x === 'string')
    .join(' ')
    .toLowerCase();
  return { org_name: orgName, text };
}

/** A keyword-list hit with what a name owner needs to claim a name. */
export type KeywordHit = MatchHit & {
  id: string;
  org_id: string | null;
  alternate_names: string[];
  service_name: string;
  /** Sum of the name clauses' scores; null when ES sent no scores. Only with name clauses. */
  name_score?: number | null;
  /** The hit's whole keyword score. Only with name clauses. */
  score?: number;
};

export function keywordHit(id: string, source: unknown): KeywordHit {
  const src = (source ?? {}) as Record<string, unknown>;
  const org = src.organization as
    { id?: unknown; alternate_name?: unknown } | string | undefined;
  const orgObj = typeof org === 'object' && org !== null ? org : {};
  return {
    ...matchHit(source),
    id,
    org_id: typeof orgObj.id === 'string' ? orgObj.id : null,
    alternate_names: alternateNames(orgObj.alternate_name),
    service_name: typeof src.name === 'string' ? src.name : '',
  };
}

export type KeywordList = {
  state: 'ok' | 'failed' | 'skipped';
  hits: KeywordHit[];
};

export type NameClaim = {
  status: 'ok' | 'failed' | 'skipped';
  strength: 'org' | 'service' | 'none';
  org_ids: string[];
  service_ids: string[];
  name: string | null;
  /** Variant 'metric': the named org's share of its keyword score (0 to 1). */
  metric?: number;
};

/** `out_of_radius` null: the owner cannot tell out of radius from not found. */
export type NameMatch = NameClaim & {
  vetoed: boolean;
  pinned: number;
  out_of_radius: boolean | null;
};

export type NameOwner = {
  claim(keyword: KeywordList): Promise<NameClaim>;
  /** Evidence: the fused top hits, as keyword hits. True: a common word, not a name. */
  vetoes(evidence: KeywordHit[]): boolean;
  /** Where the pinned ids come from: an index read or the keyword hits. */
  pinFrom: 'read' | 'keyword';
  /** Extra clauses (`_name` starts with NAME_CLAUSE) for the keyword list. */
  clauses?(rarity: NameRarity): QueryDslQueryContainer[];
};

/** What the name clauses read of the request's word rarity. */
export type NameRarity = {
  words: Record<string, number>;
  typoClauses: boolean;
} | null;

/**
 * Variants of the keyword owner (V2_NAME_MATCH_VARIANTS, comma list; none by
 * default). Each stands alone. All boosts and cutoffs here are not measured.
 *   boost  name fields, all words (BM25: a rare word counts more)
 *   phrase name fields, words close together and in order
 *   alias  organization.alternate_name phrase
 *   typo   organization.name with the keyword list's typo tolerance
 *   rare   organization.name, one clause per word, weight = the word's idf
 *   metric the claim reads the ES name score, not the name text
 */
export const NAME_VARIANTS = [
  'boost',
  'phrase',
  'alias',
  'typo',
  'rare',
  'metric',
] as const;
export type NameVariant = (typeof NAME_VARIANTS)[number];

export const parseNameVariants = (raw: string | undefined): NameVariant[] =>
  NAME_VARIANTS.filter((v) =>
    (raw ?? '')
      .split(',')
      .map((x) => x.trim())
      .includes(v),
  );

const NAME_CLAUSE = 'name_owner:';
const NAME_FIELDS = ['organization.name', 'name'];
// The name lookup's boosts (name-lookup.service.ts); org-name tier for `rare`.
const NAME_BOOST = { phrase: 12, alias: 8, words: 4, rare: 6 };
// Provisional, not measured: an org is named when the name clauses give at
// least this share of its best hit's score.
const NAME_METRIC_MIN = 0.5;

function nameClauses(
  text: string,
  variants: NameVariant[],
  rarity: NameRarity,
): QueryDslQueryContainer[] {
  const on = (v: NameVariant) => variants.includes(v);
  const out: QueryDslQueryContainer[] = [];
  if (on('boost') || on('metric')) {
    for (const field of NAME_FIELDS) {
      out.push({
        match: {
          [field]: {
            query: text,
            operator: 'and',
            boost: NAME_BOOST.words,
            _name: `${NAME_CLAUSE}boost:${field}`,
          },
        },
      });
    }
  }
  if (on('phrase') || on('metric')) {
    for (const field of NAME_FIELDS) {
      out.push({
        match_phrase: {
          [field]: {
            query: text,
            slop: 2,
            boost: NAME_BOOST.phrase,
            _name: `${NAME_CLAUSE}phrase:${field}`,
          },
        },
      });
    }
  }
  if (on('alias')) {
    out.push({
      match_phrase: {
        'organization.alternate_name': {
          query: text,
          boost: NAME_BOOST.alias,
          _name: `${NAME_CLAUSE}alias`,
        },
      },
    });
  }
  if (on('typo') && rarity?.typoClauses !== false) {
    const fuzzy = fuzzyFallbackFor({
      multi_match: {
        query: text,
        operator: 'and',
        fields: ['organization.name'],
      },
    });
    out.push({
      multi_match: { ...fuzzy.multi_match!, _name: `${NAME_CLAUSE}typo` },
    });
  }
  if (on('rare')) {
    for (const [word, weight] of Object.entries(rarity?.words ?? {})) {
      out.push({
        constant_score: {
          filter: { match: { 'organization.name': word } },
          boost: NAME_BOOST.rare * weight,
          _name: `${NAME_CLAUSE}rare:${word}`,
        },
      });
    }
  }
  return out;
}

/** Sum of a hit's name-clause scores; null when ES sent names without scores. */
export function nameScore(
  matched: string[] | Record<string, number> | undefined,
): number | null {
  if (matched === undefined) return 0;
  if (Array.isArray(matched)) return matched.length === 0 ? 0 : null;
  return Object.entries(matched).reduce(
    (sum, [k, v]) => (k.startsWith(NAME_CLAUSE) ? sum + v : sum),
    0,
  );
}

/**
 * The org the ES name scores point at: share = name score / whole score of the
 * org's best hit. More than `nameLookupSize` orgs at or over the minimum: the
 * words are common to many names, so nothing is named. Null: no scores.
 */
function metricClaim(hits: KeywordHit[]): NameClaim | null {
  const best = new Map<string, { share: number; name: string }>();
  for (const h of hits) {
    if (h.name_score === null) return null;
    if (!h.org_id || !h.score || !h.name_score) continue;
    const share = h.name_score / h.score;
    if (share >= NAME_METRIC_MIN && share > (best.get(h.org_id)?.share ?? 0)) {
      best.set(h.org_id, { share, name: h.org_name ?? '' });
    }
  }
  if (best.size === 0 || best.size > MATCH.nameLookupSize) return claimOf('ok');
  const top = [...best.values()].sort((a, b) => b.share - a.share)[0];
  return claimOf('ok', {
    strength: 'org',
    org_ids: [...best.keys()],
    name: top.name,
    metric: top.share,
  });
}

/** Query words with a one-edit typo of a word of the org names put right. */
function fixTypos(words: string[], names: string[]): string[] {
  const known = [
    ...new Set(names.flatMap((n) => n.toLowerCase().match(/[a-z0-9]+/g) ?? [])),
  ];
  return words.map((w) =>
    w.length < 5 || queryTokens([w]).length === 0 || known.includes(w)
      ? w
      : (known.find((k) => k.length >= 4 && withinOneEdit(w, k)) ?? w),
  );
}

const claimOf = (
  status: NameClaim['status'],
  over: Partial<NameClaim> = {},
): NameClaim => ({
  status,
  strength: 'none',
  org_ids: [],
  service_ids: [],
  name: null,
  ...over,
});

/** A service name without a trailing ' offered by/at ...', ' at ...' or ' | ...'. */
const SERVICE_SUFFIX = /\s+offered\s+(?:by|at)\s.*$|\s+at\s.*$|\s+\|.*$/i;

const holds = (words: string[], name: string, every: boolean): boolean => {
  const cov = wordCoverage(words, [
    { org_name: null, text: name.toLowerCase() },
  ]);
  return (
    cov.length > 0 && (every ? cov.every((c) => c > 0) : cov.some((c) => c > 0))
  );
};

/** The keyword list names an org (or a service): the one owner of the name match. */
export function keywordOwner(
  words: string[],
  text = '',
  variants: NameVariant[] = [],
): NameOwner {
  // The words the claim matched with; the veto reads the same ones.
  let used = words;
  return {
    pinFrom: 'keyword',
    vetoes: (evidence) => genericName(used, evidence),
    ...(variants.length > 0 && {
      clauses: (rarity: NameRarity) => nameClauses(text, variants, rarity),
    }),
    claim: (keyword) => {
      if (keyword.state === 'failed') return Promise.resolve(claimOf('failed'));
      if (keyword.state === 'skipped') {
        return Promise.resolve(claimOf('skipped'));
      }
      if (variants.includes('metric')) {
        return Promise.resolve(metricClaim(keyword.hits) ?? claimOf('failed'));
      }
      const orgs = new Map<string, NameCandidate>();
      for (const h of keyword.hits) {
        if (h.org_id && h.org_name && !orgs.has(h.org_id)) {
          orgs.set(h.org_id, {
            id: h.org_id,
            name: h.org_name,
            alternate_names: h.alternate_names,
          });
        }
      }
      const candidates = [...orgs.values()].slice(0, MATCH.nameLookupSize);
      let named = nameMatch(words, candidates);
      if (!named.named && variants.includes('typo')) {
        const fixed = fixTypos(
          words,
          candidates.flatMap((c) => [c.name, ...c.alternate_names]),
        );
        named = nameMatch(fixed, candidates);
        if (named.named) used = fixed;
      }
      if (named.named) {
        const ids = new Set(named.org_ids);
        return Promise.resolve(
          claimOf('ok', {
            strength: 'org',
            org_ids: named.org_ids,
            name: named.name,
            service_ids: keyword.hits
              .filter(
                (h) =>
                  h.org_id !== null &&
                  ids.has(h.org_id) &&
                  holds(used, h.service_name, false),
              )
              .map((h) => h.id),
          }),
        );
      }
      const services = keyword.hits.filter((h) =>
        holds(words, h.service_name.replace(SERVICE_SUFFIX, ''), true),
      );
      return Promise.resolve(
        services.length > 0
          ? claimOf('ok', {
              strength: 'service',
              service_ids: services.map((h) => h.id),
              name: services[0].service_name,
            })
          : claimOf('ok'),
      );
    },
  };
}
