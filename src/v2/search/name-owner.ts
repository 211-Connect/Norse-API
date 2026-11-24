import {
  MATCH,
  MatchHit,
  NameCandidate,
  genericName,
  nameMatch,
  wordCoverage,
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
export function keywordOwner(words: string[]): NameOwner {
  return {
    pinFrom: 'keyword',
    vetoes: (evidence) => genericName(words, evidence),
    claim: (keyword) => {
      if (keyword.state === 'failed') return Promise.resolve(claimOf('failed'));
      if (keyword.state === 'skipped') {
        return Promise.resolve(claimOf('skipped'));
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
      const named = nameMatch(
        words,
        [...orgs.values()].slice(0, MATCH.nameLookupSize),
      );
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
                  holds(words, h.service_name, false),
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
