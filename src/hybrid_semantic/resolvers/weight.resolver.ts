import { Injectable } from '@nestjs/common';
import { SearchRequestDto } from '../dto/search-request.dto';
import { WeightsConfigService } from '../config/weights-config.service';
import { WeightConfig } from '../strategies/search-strategy.interface';

/**
 * Service responsible for resolving weights from multiple sources
 * Consolidates weight extraction logic that was previously duplicated
 * across HybridSemanticService and OpenSearchService
 */
@Injectable()
export class WeightResolver {
  constructor(private readonly weightsConfigService: WeightsConfigService) {}

  /**
   * Resolve weights with priority:
   * 1. Request-level custom_weights (highest priority)
   * 2. Configuration file defaults (from weights-config.service)
   * 
   * @param searchRequest - Search request potentially containing custom weights
   * @returns Resolved weight configuration
   */
  resolve(searchRequest: SearchRequestDto): WeightConfig {
    const configDefaults = this.weightsConfigService.getConfig();

    return {
      semantic: {
        service:
          searchRequest.custom_weights?.semantic?.service ??
          configDefaults.semantic.service,
        taxonomy:
          searchRequest.custom_weights?.semantic?.taxonomy ??
          configDefaults.semantic.taxonomy,
        organization:
          searchRequest.custom_weights?.semantic?.organization ??
          configDefaults.semantic.organization,
      },
      strategies: {
        semantic_search:
          searchRequest.custom_weights?.strategies?.semantic_search ??
          configDefaults.strategies.semantic_search,
        keyword_search:
          searchRequest.custom_weights?.strategies?.keyword_search ??
          configDefaults.strategies.keyword_search,
        intent_driven:
          searchRequest.custom_weights?.strategies?.intent_driven ??
          configDefaults.strategies.intent_driven,
      },
      geospatial: {
        weight:
          searchRequest.custom_weights?.geospatial?.weight ??
          configDefaults.geospatial.weight,
        decay_scale:
          searchRequest.custom_weights?.geospatial?.decay_scale ??
          searchRequest.distance ??
          configDefaults.geospatial.decay_scale,
        decay_offset:
          searchRequest.custom_weights?.geospatial?.decay_offset ??
          configDefaults.geospatial.decay_offset,
      },
    };
  }
}
