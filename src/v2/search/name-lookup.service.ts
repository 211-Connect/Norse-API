import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { MATCH, NameCandidate } from '../rules/match';
import { SearchUtilsService } from '../../search/search-utils.service';

/**
 * Which orgs have a name that looks like the query? One read-only search of
 * the resource index, collapsed to one hit per org. The match measure
 * (`nameMatch`) decides whether the query names an org. With coords the
 * orgs are the nearest ones, not the best text scores. Any error or timeout
 * gives `null`: the caller matches on the hits only and does not cache.
 */
@Injectable()
export class NameLookupService {
  private readonly logger = new Logger(NameLookupService.name);

  constructor(private readonly elasticsearch: ElasticsearchService) {}

  async lookup(
    tenantId: string,
    index: string,
    text: string,
    coords?: number[],
  ): Promise<NameCandidate[] | null> {
    try {
      const res = await this.elasticsearch.search(
        {
          index,
          size: MATCH.nameLookupSize,
          timeout: '500ms',
          track_total_hits: false,
          collapse: { field: 'organization.id' },
          // With coords the nearest orgs fill the few slots, so a name shared
          // by orgs in many states ('catholic charities') finds the local one.
          ...(coords?.length === 2 && {
            sort: [SearchUtilsService.getGeoDistanceSort(coords)],
          }),
          _source: [
            'organization.id',
            'organization.name',
            'organization.alternate_name',
          ],
          query: {
            bool: {
              filter: [{ term: { tenant_id: tenantId } }],
              should: [
                {
                  match_phrase: {
                    'organization.name': { query: text, boost: 12 },
                  },
                },
                {
                  match: {
                    'organization.name': {
                      query: text,
                      operator: 'and',
                      boost: 4,
                    },
                  },
                },
                {
                  match_phrase: {
                    'organization.alternate_name': { query: text, boost: 8 },
                  },
                },
              ],
              minimum_should_match: 1,
            },
          },
        },
        { requestTimeout: 800 },
      );
      // A timeout inside ES is a 200 with partial hits: not "no org named".
      if (res.timed_out || (res._shards?.failed ?? 0) > 0) {
        this.logger.warn('Name lookup partial (timed out or failed shards)');
        return null;
      }
      return candidatesOf(res.hits?.hits ?? []);
    } catch (error) {
      // The error text can hold the query; log the error type only.
      this.logger.warn(
        `Name lookup failed (${(error as Error)?.name ?? 'error'})`,
      );
      return null;
    }
  }
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

function candidatesOf(hits: unknown[]): NameCandidate[] {
  const out: NameCandidate[] = [];
  for (const h of hits) {
    const org = (h as { _source?: { organization?: unknown } })._source
      ?.organization as
      { id?: unknown; name?: unknown; alternate_name?: unknown } | undefined;
    if (typeof org?.id !== 'string' || typeof org.name !== 'string') continue;
    if (org.id === '' || org.name === '') continue;
    out.push({
      id: org.id,
      name: org.name,
      alternate_names: alternateNames(org.alternate_name),
    });
  }
  return out;
}
