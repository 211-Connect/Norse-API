import { BadRequestException } from '@nestjs/common';
import { Sort } from '@elastic/elasticsearch/lib/api/types';

const FACETS_FIELD_PREFIX = 'facets.';

/**
 * Build Elasticsearch filter clauses from facets, geo coordinates, distance,
 * geo_type, and geometry. Extracted from SearchService so both the standard
 * and hybrid search paths share a single implementation.
 */
export function buildFilters(
  facets: Record<string, any>,
  coords: number[] | undefined,
  distance: number,
  geo_type: string | undefined,
  geometry: any,
): any[] {
  const filters: any[] = [];

  // Facet term filters
  for (const [key, value] of Object.entries(facets || {})) {
    const field = `${FACETS_FIELD_PREFIX}${key}.keyword`;

    if (Array.isArray(value)) {
      for (const item of value) {
        filters.push({ term: { [field]: item } });
      }
    } else {
      filters.push({ term: { [field]: value } });
    }
  }

  // Boundary search mode
  if (geo_type === 'boundary') {
    if (!geometry) {
      throw new BadRequestException('Geometry is required for boundary search');
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

  // Proximity search mode (default)
  if (coords) {
    const [lon, lat] = coords.map(Number);

    // Service-area containment
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

    // Distance check (when distance > 0)
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
 * Build the sort clause used for standard (non-hybrid) search.
 * Priority descending is the primary sort; geo-distance is secondary when
 * coordinates are provided.
 */
export function buildSort(coords: number[] | undefined): Sort {
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

/**
 * Haversine distance between two (lat, lon) pairs. Returns distance in miles.
 */
export function haversineDistanceMiles(
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
 * { lat, lon } or null. Handles objects, arrays, and lat,lon strings.
 */
export function parseLocationPoint(
  point: any,
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
