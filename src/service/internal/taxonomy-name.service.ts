import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { errors } from '@elastic/elasticsearch';
import {
  SearchHit,
  SearchRequest,
  SearchResponse,
  SortResults,
} from '@elastic/elasticsearch/lib/api/types';
import { callElasticsearch } from 'src/common/elasticsearch/es-call';
import { shardPreference } from 'src/common/elasticsearch/shard-preference';
import { hashCacheKey } from 'src/common/lib/hash-cache-key';
import { normalizeAirsCode } from './airs';
import { NamedTerm, preferredTerm } from './taxonomy-names';

export const TAXONOMY_TERMS_INDEX = 'taxonomy_terms';
export const TAXONOMY_TERMS_PAGE_SIZE = 1000;
/** Three stored forms each keeps a query far below ES's 65,536-term `terms` limit. */
export const TAXONOMY_TERMS_CODES_PER_QUERY = 5000;

interface TaxonomyTermSource {
  resourceWriterId: string;
  code: string;
  isAncestor?: boolean;
  names?: Record<string, string>;
}

export interface TaxonomyNamesQuery {
  resourceWriterIds: string[];
  codes: string[];
  locale?: string;
}

export const DEFAULT_TAXONOMY_LOCALE = 'en';

export type NamesByWriter = Record<string, Record<string, string>>;

/** Writer → normalized code → name. */
export type NormalizedNames = Map<string, Map<string, string>>;

/**
 * A writer's own term keeps the code as written (`BD-1800.`); derived ancestors
 * are stored normalized. A normalized code is looked up in every form it is
 * stored under in practice.
 */
const storedForms = (code: string): string[] => [code, `${code}.`, `${code}-`];

@Injectable()
export class TaxonomyNameService {
  private readonly logger = new Logger(TaxonomyNameService.name);

  constructor(private readonly elasticsearch: ElasticsearchService) {}

  async lookup(query: TaxonomyNamesQuery): Promise<{ names: NamesByWriter }> {
    const resolved = await this.resolve(
      query.resourceWriterIds,
      query.codes.map(normalizeAirsCode),
      query.locale ?? DEFAULT_TAXONOMY_LOCALE,
    );
    const names: NamesByWriter = {};
    for (const [writer, byCode] of resolved) {
      for (const requested of query.codes) {
        const name = byCode.get(normalizeAirsCode(requested));
        if (name !== undefined) (names[writer] ??= {})[requested] = name;
      }
    }
    return { names };
  }

  async resolve(
    resourceWriterIds: string[],
    normalizedCodes: string[],
    locale: string,
  ): Promise<NormalizedNames> {
    const codes = [...new Set(normalizedCodes)];
    const preference = shardPreference(
      'taxonomy-terms',
      hashCacheKey({
        writers: [...resourceWriterIds].sort(),
        codes: [...codes].sort(),
      }),
    );
    const hits: SearchHit<TaxonomyTermSource>[] = [];
    for (let i = 0; i < codes.length; i += TAXONOMY_TERMS_CODES_PER_QUERY) {
      const chunk = codes.slice(i, i + TAXONOMY_TERMS_CODES_PER_QUERY);
      hits.push(
        ...(await this.allHits({
          index: TAXONOMY_TERMS_INDEX,
          preference,
          size: TAXONOMY_TERMS_PAGE_SIZE,
          _source: ['resourceWriterId', 'code', 'isAncestor', 'names'],
          query: {
            bool: {
              filter: [
                { terms: { resourceWriterId: resourceWriterIds } },
                { terms: { code: chunk.flatMap(storedForms) } },
              ],
            },
          },
          // (writer, taxonomy, code) is unique per document, so pages never skip or repeat.
          sort: [
            { resourceWriterId: 'asc' },
            { taxonomy: 'asc' },
            { code: 'asc' },
          ],
        })),
      );
    }
    const terms = new Map<string, Map<string, NamedTerm>>();
    for (const hit of hits) {
      const doc = hit._source;
      const name = doc?.names?.[locale];
      if (!doc || !name) continue;
      const byCode =
        terms.get(doc.resourceWriterId) ??
        terms.set(doc.resourceWriterId, new Map()).get(doc.resourceWriterId)!;
      const code = normalizeAirsCode(doc.code);
      const candidate = { name, isAncestor: doc.isAncestor === true };
      const held = byCode.get(code);
      byCode.set(code, held ? preferredTerm(held, candidate) : candidate);
    }
    return new Map(
      [...terms].map(([writer, byCode]) => [
        writer,
        new Map([...byCode].map(([code, t]) => [code, t.name])),
      ]),
    );
  }

  private async allHits(
    request: SearchRequest,
  ): Promise<SearchHit<TaxonomyTermSource>[]> {
    const out: SearchHit<TaxonomyTermSource>[] = [];
    let after: SortResults | undefined;
    for (;;) {
      const page = await this.search({
        ...request,
        ...(after ? { search_after: after } : {}),
      });
      const hits = page?.hits.hits ?? [];
      out.push(...hits);
      after = hits[hits.length - 1]?.sort;
      if (hits.length < TAXONOMY_TERMS_PAGE_SIZE || !after) return out;
    }
  }

  /** Null before Dagster's first reader run creates the index: no names yet. */
  private async search(
    request: SearchRequest,
  ): Promise<SearchResponse<TaxonomyTermSource> | null> {
    return callElasticsearch(
      { label: 'Taxonomy names', logger: this.logger },
      () =>
        this.elasticsearch
          .search<TaxonomyTermSource>(request)
          .catch((error: unknown) => {
            if (isIndexNotFound(error)) return null;
            throw error;
          }),
    );
  }
}

function isIndexNotFound(error: unknown): boolean {
  return (
    error instanceof errors.ResponseError &&
    error.statusCode === 404 &&
    error.body?.error?.type === 'index_not_found_exception'
  );
}
