// The Region module's public surface. Other modules import from here, never
// from the files behind it.
export {
  REGIONS_INDEX,
  REGION_GEOMETRY_PATH,
  REGION_ID_PATTERN,
  REGION_SERVICE_AREA_PATH,
  regionIdMessage,
  unknownRegionsError,
} from './region.constants';
export { RegionService, type GeocodeHit } from './region.service';
export { RegionDetailDto, RegionSummaryDto, RegionIdParamDto } from './dto';
export type { RegionType } from './dto';
export { RegionInternalModule, RegionServiceModule } from './region.module';
