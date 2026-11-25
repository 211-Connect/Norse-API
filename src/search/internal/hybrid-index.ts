import { Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { languageIndexSuffix } from 'src/common/locales';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { MetricsService } from 'src/metrics/metrics.service';

/**
 * How long an answer to "does this tenant have a hybrid alias" is reused, in ms.
 *
 * The alias only appears with a tenant's first hybrid run in a language, and a
 * publish moves it atomically (one `update_aliases`), so it does not flicker.
 * A minute keeps the lookup off the hot path without delaying a new tenant much.
 */
export const HYBRID_ALIAS_EXISTS_TTL_MS = 60 * 1000;

export interface HybridIndexDeps {
  elasticsearch: Pick<ElasticsearchService, 'indices'>;
  cache: Pick<RequestCacheService, 'getOrSet'>;
  metrics: Pick<MetricsService, 'observeDownstream'>;
  logger: Pick<Logger, 'warn'>;
  /** Longest wait for the alias check, in ms; unset = the client default. */
  aliasCheckLimitMs?: number;
}

/**
 * The index name a tenant's hybrid reads use: search and count (HybridSearchService).
 *
 * Dagster keeps every tenant in one shared index per language, and publishes a
 * tenant by pointing the tenant's alias, `{tenant}-hybrid_search_resources_{lang}`,
 * at the tenant's complete temp index while it rewrites the shared one. Reading
 * the alias therefore never sees a half-published tenant; reading the shared
 * name does. A tenant with no hybrid run in this language has no alias yet, so
 * it keeps reading the shared name, filtered by tenant, as before.
 *
 * A failed alias check (a timeout, a missing privilege) also reads the shared
 * name, as before this lookup existed, and logs a warning. The failure is not
 * cached, so the next request checks again. A lang that is not a language code
 * still throws the 400 from `languageIndexSuffix`.
 */
export async function resolveHybridIndex(
  deps: HybridIndexDeps,
  tenantId: string,
  lang: string,
): Promise<string> {
  const shared = `hybrid_search_resources_${languageIndexSuffix(lang)}`;
  const alias = `${tenantId}-${shared}`;
  try {
    const exists = await deps.cache.getOrSet(
      `hybrid_alias_exists:${alias}`,
      () =>
        deps.metrics.observeDownstream(
          'elasticsearch',
          'hybrid_alias_exists',
          () =>
            deps.aliasCheckLimitMs === undefined
              ? deps.elasticsearch.indices.existsAlias({ name: alias })
              : deps.elasticsearch.indices.existsAlias(
                  { name: alias },
                  { requestTimeout: deps.aliasCheckLimitMs },
                ),
        ),
      HYBRID_ALIAS_EXISTS_TTL_MS,
    );
    return exists ? alias : shared;
  } catch (error) {
    deps.logger.warn(
      `Hybrid alias check failed for ${alias}, reading ${shared}: ${(error as Error).message}`,
    );
    return shared;
  }
}
