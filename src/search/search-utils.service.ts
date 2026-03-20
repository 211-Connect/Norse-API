import { BadRequestException } from '@nestjs/common';
import {
  AggregationsStringTermsAggregate,
  AggregationsStringTermsBucketKeys,
  QueryDslQueryContainer,
  Sort,
} from '@elastic/elasticsearch/lib/api/types';
import { SearchBodyDto } from './dto/search-body.dto';
import { DocumentFacets, SearchFacet } from './dto/search-response.dto';
import {
  Aggregations,
  LocationPointInput,
  RawResourceDocument,
  ShardsInfo,
} from './types';
import { FacetConfig } from '../cms-config/types';

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
  private static readonly FACETS_EN_FIELD_PREFIX = 'facets_en.';
  private static readonly TAXONOMY_NAMES_PREFIX = 'taxonomy_names.';
  private static readonly FACETS_LIMIT = 100;

  static buildFilters(
    facets: Record<string, string | string[]>,
    coords: number[] | undefined,
    distance: number,
    geoType: string | undefined,
    geometry: SearchBodyDto['geometry'],
  ): QueryDslQueryContainer[] {
    const filters: QueryDslQueryContainer[] = [];

    for (const [key, value] of Object.entries(facets || {})) {
      const localeField = `${SearchUtilsService.FACETS_FIELD_PREFIX}${key}.keyword`;
      const enField = `${SearchUtilsService.FACETS_EN_FIELD_PREFIX}${key}.keyword`;

      const values = Array.isArray(value) ? value : [value];

      for (const item of values) {
        filters.push({
          bool: {
            should: [
              { term: { [localeField]: item } },
              { term: { [enField]: item } },
            ],
            minimum_should_match: 1,
          },
        });
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

  private static getGeoDistanceSort(coords: number[]): Sort {
    const [lon, lat] = coords;
    return [
      {
        _geo_distance: {
          'location.point': { lon, lat },
          order: 'asc',
          unit: 'm',
          mode: 'min',
        },
      },
    ];
  }

  /**
   * Build the sort clause for standard (non-hybrid) search.
   * Priority descending is the primary sort; geo-distance is secondary when
   * coordinates are provided.
   */
  static buildSort(coords: number[] | undefined, sortOption?: string): Sort {
    const baseSort: Sort = [{ priority: 'desc' }];

    switch (sortOption) {
      case 'distance':
        if (coords) {
          return this.getGeoDistanceSort(coords);
        }
        return baseSort;

      case 'name':
        return [{ 'name.raw': { order: 'asc' } }, ...baseSort];

      case 'organization':
        return [
          { 'organization.name.raw': { order: 'asc' } },
          { 'name.raw': { order: 'asc' } },
          ...baseSort,
        ];

      case 'relevance':
      default:
        if (coords) {
          return baseSort.concat(this.getGeoDistanceSort(coords));
        }
        return baseSort;
    }
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

  static buildFacetAggregations(
    tenantFacets: FacetConfig[],
    locale: string,
  ): Aggregations {
    const aggregations: Aggregations = {};

    for (const f of tenantFacets) {
      const key = f.facet;

      aggregations[key] = {
        terms: {
          field: `${SearchUtilsService.FACETS_FIELD_PREFIX}${key}.keyword`,
          size: SearchUtilsService.FACETS_LIMIT,
        },
      };

      if (locale !== 'en') {
        aggregations[`${key}_en`] = {
          terms: {
            field: `${SearchUtilsService.FACETS_EN_FIELD_PREFIX}${key}.keyword`,
            size: SearchUtilsService.FACETS_LIMIT,
          },
        };
      }

      const labelFieldBase = `${SearchUtilsService.TAXONOMY_NAMES_PREFIX}${key}`;

      aggregations[`label_${key}_en`] = {
        terms: {
          field: `${labelFieldBase}.en.keyword`,
          size: 1,
        },
      };

      if (locale !== 'en') {
        aggregations[`label_${key}_${locale}`] = {
          terms: {
            field: `${labelFieldBase}.${locale}.keyword`,
            size: 1,
          },
        };
      }
    }

    return aggregations;
  }

  static normalizeDocFacets(
    source: RawResourceDocument,
    locale: string,
  ): DocumentFacets {
    const rawFacets = source?.facets ?? {};
    const en = source?.facets_en ?? {};

    const localized: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(rawFacets)) {
      if (typeof v === 'string' || Array.isArray(v)) {
        localized[k] = v;
      }
    }

    const keys = new Set<string>([
      ...Object.keys(localized),
      ...Object.keys(en),
    ]);

    const out: DocumentFacets = {};

    const toArray = (v: string | string[] | null | undefined): string[] => {
      if (v == null) return [];
      return Array.isArray(v) ? v.map(String) : [String(v)];
    };

    for (const k of keys) {
      const locVal = localized[k];
      const enVal = en[k];

      if (locale === 'en') {
        const vals = locVal ? toArray(locVal) : enVal ? toArray(enVal) : [];
        if (vals.length > 0) {
          out[k] = { en: vals };
        }
      } else {
        const entry: Record<string, string[]> = {};
        if (enVal) {
          const arr = toArray(enVal);
          if (arr.length > 0) entry.en = arr;
        }
        if (locVal) {
          const arr = toArray(locVal);
          if (arr.length > 0) entry[locale] = arr;
        }
        if (Object.keys(entry).length > 0) {
          out[k] = entry;
        }
      }
    }

    return out;
  }

  static transformAggregations(
    tenantFacets: FacetConfig[],
    aggregations: Record<string, AggregationsStringTermsAggregate> | undefined,
    locale: string,
  ): SearchFacet[] {
    const result: SearchFacet[] = [];

    for (const f of tenantFacets) {
      const key = f.facet;

      const labelEn = SearchUtilsService.getLabelFromAgg(
        aggregations,
        `label_${key}_en`,
        f.name,
      );

      const localeLabel =
        locale !== 'en'
          ? SearchUtilsService.getLabelFromAgg(
              aggregations,
              `label_${key}_${locale}`,
              labelEn,
            )
          : labelEn;

      const name = { en: labelEn, locale: localeLabel };

      const primaryBuckets = SearchUtilsService.getBuckets(
        aggregations,
        locale === 'en' ? key : `${key}_en`,
      );
      const localeBuckets =
        locale !== 'en' ? SearchUtilsService.getBuckets(aggregations, key) : [];

      const values = primaryBuckets.map((b, i) => ({
        en: b.key,
        locale: locale !== 'en' ? (localeBuckets[i]?.key ?? b.key) : b.key,
        doc_count: b.doc_count,
      }));

      if (values.length > 0) {
        result.push({ key, name, values });
      }
    }

    return result;
  }

  static mergeShardsInfo(a: ShardsInfo, b: ShardsInfo): ShardsInfo {
    return {
      total: a.total + b.total,
      successful: a.successful + b.successful,
      skipped: a.skipped + b.skipped,
      failed: a.failed + b.failed,
    };
  }

  private static getLabelFromAgg(
    aggregations: Record<string, AggregationsStringTermsAggregate> | undefined,
    aggName: string,
    fallback: string,
  ): string {
    const agg = aggregations?.[aggName];
    const bucket = Array.isArray(agg?.buckets) ? agg.buckets[0] : null;
    return bucket?.key ? String(bucket.key) : fallback;
  }

  private static getBuckets(
    aggregations: Record<string, AggregationsStringTermsAggregate> | undefined,
    aggName: string,
  ): Array<{ key: string; doc_count: number }> {
    const agg = aggregations?.[aggName];
    const buckets = agg?.buckets;
    if (!buckets) return [];
    const arr = Array.isArray(buckets)
      ? buckets
      : Object.values(
          buckets as Record<string, AggregationsStringTermsBucketKeys>,
        );
    return arr.map((b) => ({ key: String(b.key), doc_count: b.doc_count }));
  }
}
