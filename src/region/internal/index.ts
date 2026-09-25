// The Region module's public surface. Other modules import from here, never
// from the files behind it.
export {
  REGIONS_INDEX,
  REGION_ID_PATTERN,
  regionIdMessage,
  unknownRegionsError,
} from './region.constants';
export { RegionService } from './region.service';
export { RegionInternalModule, RegionServiceModule } from './region.module';
