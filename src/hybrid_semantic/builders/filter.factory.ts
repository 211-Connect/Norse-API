import { Injectable, Logger } from '@nestjs/common';
import { SearchRequestDto } from '../dto/search-request.dto';

/**
 * Factory for creating OpenSearch filters
 * Encapsulates all filter creation logic in one place
 */
@Injectable()
export class FilterFactory {
  private readonly logger = new Logger(FilterFactory.name);

  /**
   * Create a geo_distance filter for hard distance filtering
   * @param lat - Latitude
   * @param lon - Longitude
   * @param distance - Maximum distance in miles
   * @returns OpenSearch geo_distance filter
   */
  createGeoDistanceFilter(lat: number, lon: number, distance: number): any {
    return {
      geo_distance: {
        distance: `${distance}mi`,
        'location.point': { lat, lon },
      },
    };
  }

  /**
   * Create a service area filter using geo_shape
   * Filters to services where the user's location is within the service area boundary
   * OR services with no service area defined (null handling)
   * 
   * @param lat - Latitude
   * @param lon - Longitude
   * @returns OpenSearch geo_shape filter with null handling
   */
  createServiceAreaFilter(lat: number, lon: number): any {
    this.logger.debug(
      `Creating service area filter for location: [${lon}, ${lat}]`,
    );

    return {
      bool: {
        should: [
          {
            // User location is within the service area polygon
            geo_shape: {
              'serviceArea.extent': {
                shape: {
                  type: 'point',
                  coordinates: [lon, lat], // GeoJSON order: [lon, lat]
                },
                relation: 'contains', // Service area must contain the user's point
              },
            },
          },
          {
            // Service has no service area defined (no geographic restrictions)
            bool: {
              must_not: {
                exists: {
                  field: 'serviceArea.extent',
                },
              },
            },
          },
        ],
        minimum_should_match: 1, // At least one condition must be true
      },
    };
  }

  /**
   * Create taxonomy AND filters
   * Each code becomes a separate filter (AND logic at the bool level)
   * 
   * @param codes - Array of taxonomy codes that must all match
   * @returns Array of OpenSearch nested filters
   */
  createTaxonomyAndFilters(codes: string[]): any[] {
    this.logger.debug(
      `Creating ${codes.length} AND taxonomy filters: [${codes.join(', ')}]`,
    );

    return codes.map((code) => ({
      nested: {
        path: 'taxonomies',
        query: {
          term: {
            'taxonomies.code': code,
          },
        },
      },
    }));
  }

  /**
   * Create taxonomy OR filter
   * Single filter with terms query (OR logic within the filter)
   * 
   * @param codes - Array of taxonomy codes where any can match
   * @returns OpenSearch nested filter with terms query
   */
  createTaxonomyOrFilter(codes: string[]): any {
    this.logger.debug(
      `Creating OR taxonomy filter with ${codes.length} codes: [${codes.join(', ')}]`,
    );

    return {
      nested: {
        path: 'taxonomies',
        query: {
          terms: {
            'taxonomies.code': codes,
          },
        },
      },
    };
  }

  /**
   * Build all filters for a search request
   * Handles geo distance, service area, and taxonomy filters
   * 
   * @param searchRequest - Search request with filter parameters
   * @returns Array of OpenSearch filters
   */
  buildAllFilters(searchRequest: SearchRequestDto): any[] {
    const filters: any[] = [];

    // Geospatial distance filter (hard filter)
    if (searchRequest.lat && searchRequest.lon && searchRequest.distance) {
      filters.push(
        this.createGeoDistanceFilter(
          searchRequest.lat,
          searchRequest.lon,
          searchRequest.distance,
        ),
      );
    }

    // Service area filter (geo-shape query)
    // Only apply when lat/lon are provided (geospatial query)
    if (searchRequest.lat && searchRequest.lon) {
      filters.push(
        this.createServiceAreaFilter(searchRequest.lat, searchRequest.lon),
      );
    }

    // Taxonomy query filters (AND/OR logic)
    if (searchRequest.taxonomies) {
      if (searchRequest.taxonomies.AND?.length > 0) {
        filters.push(
          ...this.createTaxonomyAndFilters(searchRequest.taxonomies.AND),
        );
      }
      if (searchRequest.taxonomies.OR?.length > 0) {
        filters.push(
          this.createTaxonomyOrFilter(searchRequest.taxonomies.OR),
        );
      }
    }

    return filters;
  }
}
