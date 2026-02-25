import { BadRequestException } from '@nestjs/common';
import {
  QueryDslQueryContainer,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';
import { SearchBodyDto } from './dto/search-body.dto';
import { LocationPointInput } from './types';

export class SearchUtilsService {
  static readonly FIELDS_TO_QUERY: string[] = [
    'name',
    'description',
    'summary',
    'service.name',
    'service.alternate_name',
    'service.description',
    'service.summary',
    'location.name',
    'location.alternate_name',
    'location.description',
    'location.summary',
    'organization.name',
    'organization.alternate_name',
    'organization.description',
    'organization.summary',
  ];

  static readonly NESTED_FIELDS_TO_QUERY: string[] = [
    'taxonomies.name',
    'taxonomies.description',
  ];

  private static readonly FACETS_FIELD_PREFIX = 'facets.';

  static buildFilters(
    facets: Record<string, string | string[]>,
    coords: number[] | undefined,
    distance: number,
    geoType: string | undefined,
    geometry: SearchBodyDto['geometry'],
  ): QueryDslQueryContainer[] {
    const filters: QueryDslQueryContainer[] = [];

    for (const [key, value] of Object.entries(facets || {})) {
      const field = `${SearchUtilsService.FACETS_FIELD_PREFIX}${key}.keyword`;

      if (Array.isArray(value)) {
        for (const item of value) {
          filters.push({ term: { [field]: item } });
        }
      } else {
        filters.push({ term: { [field]: value } });
      }
    }

    if (geoType === 'boundary') {
      if (!geometry) {
        throw new BadRequestException(
          'Geometry is required for boundary search',
        );
      }

      filters.push({
        geo_shape: {
          service_area: {
            shape: geometry,
            relation: 'intersects',
          },
        },
      });

      return filters;
    }

    if (coords) {
      const [lon, lat] = coords.map(Number);

      filters.push({
        geo_shape: {
          service_area: {
            shape: {
              type: 'point',
              coordinates: [lon, lat],
            },
            relation: 'contains',
          },
        },
      });

      if (distance > 0) {
        filters.push({
          bool: {
            should: [
              {
                bool: {
                  must: [
                    { exists: { field: 'location.point' } },
                    {
                      geo_distance: {
                        distance: `${distance}miles`,
                        'location.point': { lon: coords[0], lat: coords[1] },
                      },
                    },
                  ],
                },
              },
              {
                bool: {
                  must_not: { exists: { field: 'location.point' } },
                },
              },
            ],
          },
        });
      }
    }

    return filters;
  }

  /**
   * Build the sort clause for standard (non-hybrid) search.
   * Priority descending is the primary sort; geo-distance is secondary when
   * coordinates are provided.
   */
  static buildSort(coords: number[] | undefined): Sort {
    const baseSort: Sort = [{ priority: 'desc' }];

    if (coords) {
      const [lon, lat] = coords;

      return baseSort.concat([
        {
          _geo_distance: {
            'location.point': { lon, lat },
            order: 'asc',
            unit: 'm',
            mode: 'min',
          },
        },
      ]);
    }

    return baseSort;
  }

  static haversineDistanceMiles(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 3958.8; // Earth radius in miles
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Parse a location.point value from an ES document _source into
   * { lat, lon } or null. Handles objects, arrays, and "lat,lon" strings.
   */
  static parseLocationPoint(
    point: LocationPointInput,
  ): { lat: number; lon: number } | null {
    if (!point) return null;

    if (typeof point === 'object' && !Array.isArray(point)) {
      const lat = Number(point.lat);
      const lon = Number(point.lon);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }

    if (Array.isArray(point) && point.length === 2) {
      // ES convention: [lon, lat]
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }

    if (typeof point === 'string') {
      const parts = point.split(',').map(Number);
      if (parts.length === 2 && parts.every((n) => !isNaN(n))) {
        return { lat: parts[0], lon: parts[1] };
      }
    }

    return null;
  }
}
