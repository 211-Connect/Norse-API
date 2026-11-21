import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { languageIndexSuffix } from 'src/common/locales';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { resolveHybridIndex } from 'src/search/internal/hybrid-index';
import { TIER1_CODES, isTier1 } from '../rules/sune';

const TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1500;

/**
 * A tenant's Tier 1 areas ranked by service count (ADR 0039 Decision 44), for
 * the start question. One size-0 terms aggregation on `sune_needs`, filtered to
 * the tenant, cached 24 h per tenant and language. It reads the tenant's alias
 * when there is one (`resolveHybridIndex`), so a cache miss during a Dagster
 * publish does not store a half-published tenant's areas for a day. A failure returns [] and is
 * not cached; the rules engine then uses its default areas.
 */
@Injectable()
export class TopAreasService {
  private readonly logger = new Logger(TopAreasService.name);

  constructor(
    private readonly elasticsearchService: ElasticsearchService,
    private readonly cache: RequestCacheService,
    private readonly metrics: MetricsService,
  ) {}

  async topAreas(
    tenantId: string,
    acceptLanguage: string | undefined,
  ): Promise<string[]> {
    const lang = acceptLanguage || 'en';
    const suffix = languageIndexSuffix(lang);
    try {
      return await this.cache.getOrSet(
        `topareas:v1:${tenantId}:${suffix}`,
        () => this.query(tenantId, lang),
        TTL_MS,
      );
    } catch (error) {
      this.logger.warn(
        `top areas failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async query(tenantId: string, lang: string): Promise<string[]> {
    // Resolved on a cache miss only: cached areas need no index.
    const index = await resolveHybridIndex(
      {
        elasticsearch: this.elasticsearchService,
        cache: this.cache,
        metrics: this.metrics,
        logger: this.logger,
      },
      tenantId,
      lang,
    );
    const response = await this.elasticsearchService.search(
      {
        index,
        size: 0,
        track_total_hits: false,
        query: { bool: { filter: [{ term: { tenant_id: tenantId } }] } },
        aggs: {
          top_areas: {
            terms: {
              field: 'sune_needs',
              include: TIER1_CODES as string[],
              size: TIER1_CODES.length,
            },
          },
        },
      },
      { requestTimeout: REQUEST_TIMEOUT_MS },
    );
    const agg = response.aggregations?.top_areas as
      { buckets?: { key: unknown; doc_count: number }[] } | undefined;
    const buckets = Array.isArray(agg?.buckets) ? agg.buckets : [];
    return buckets
      .filter(
        (b) => typeof b.key === 'string' && isTier1(b.key) && b.doc_count > 0,
      )
      .map((b) => b.key as string);
  }
}
