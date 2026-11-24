import {
  MatchHit,
  NameCandidate,
  genericName,
  nameMatch,
} from '../rules/match';

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
};

export function keywordHit(id: string, source: unknown): KeywordHit {
  const src = (source ?? {}) as Record<string, unknown>;
  const org = src.organization as
    { id?: unknown; alternate_name?: unknown } | string | undefined;
  const orgObj = typeof org === 'object' && org !== null ? org : {};
  const alt = orgObj.alternate_name;
  return {
    ...matchHit(source),
    id,
    org_id: typeof orgObj.id === 'string' ? orgObj.id : null,
    alternate_names: (Array.isArray(alt) ? alt : [alt]).filter(
      (x): x is string => typeof x === 'string',
    ),
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
};

/**
 * Today's name lookup (an index read, started with the request) is the one
 * owner. The keyword hits are not read.
 */
export function resolverOwner(
  words: string[],
  lookup: Promise<NameCandidate[] | null>,
): NameOwner {
  return {
    pinFrom: 'read',
    vetoes: (evidence) => genericName(words, evidence),
    claim: async () => {
      const candidates = await lookup.catch(() => null);
      if (candidates === null) {
        return {
          status: 'failed',
          strength: 'none',
          org_ids: [],
          service_ids: [],
          name: null,
        };
      }
      const named = nameMatch(words, candidates);
      return {
        status: 'ok',
        strength: named.named ? 'org' : 'none',
        org_ids: named.named ? named.org_ids : [],
        service_ids: [],
        name: named.named ? named.name : null,
      };
    },
  };
}
