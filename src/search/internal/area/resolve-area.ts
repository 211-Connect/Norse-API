import type { RegionService } from 'src/region/internal';
import type { SearchConfigCache } from 'src/cms-config/types/search-config-cache';
import type { SearchResourcesQueryDto } from '../../dto/search-query.dto';
import type { ResolvedLocationDto } from '../../dto/search-response.dto';
import { AreaFilter, tenantAreaMatch, tenantUnlocated } from './area-match';

/**
 * Settles an area search (`region`) for every search path, v1 and v2: checks
 * the Regions exist (`getSummaries` throws a 400 otherwise) and fills
 * `area_match`/`unlocated` from the tenant's CMS search settings when the
 * caller left them out — see docs/area-search.md. No `region`: no area, and
 * neither dependency is called.
 */
export async function resolveArea(
  query: Pick<SearchResourcesQueryDto, 'region' | 'area_match' | 'unlocated'>,
  regionService: Pick<RegionService, 'getSummaries'>,
  searchConfig: () => Promise<SearchConfigCache>,
): Promise<{ area?: AreaFilter; resolved?: ResolvedLocationDto }> {
  if (!query.region?.length) return {};

  const [regions, config] = await Promise.all([
    regionService.getSummaries(query.region),
    searchConfig(),
  ]);
  const area: AreaFilter = {
    regionIds: query.region,
    match: query.area_match ?? tenantAreaMatch(config),
    unlocated: query.unlocated ?? tenantUnlocated(config),
  };
  return {
    area,
    resolved: { regions, area_match: area.match, unlocated: area.unlocated },
  };
}
