import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { SearchRequest } from '@elastic/elasticsearch/lib/api/types';
import {
  PlaceDetailDto,
  PlaceListQueryDto,
  PlaceSummaryDto,
} from './dto/place.dto';
import { REGIONS_INDEX } from './region.constants';

export interface PlaceSource {
  id: string;
  name: string;
  state: string;
  slug: string;
  place_type: string;
  fips: string;
  lsad: string;
  centroid: [number, number];
  geometry: Record<string, unknown>;
}

const SUMMARY_FIELDS = ['id', 'name', 'state', 'slug', 'place_type'];

export function placeListRequest(query: PlaceListQueryDto): SearchRequest {
  const filter = [
    { term: { type: 'place' } },
    ...(query.state ? [{ term: { state: query.state } }] : []),
  ];
  const after = query.cursor
    ? decodeCursor(query.cursor, query.state)
    : undefined;
  return {
    index: REGIONS_INDEX,
    size: (query.limit ?? 25) + 1,
    track_total_hits: false,
    _source: SUMMARY_FIELDS,
    query: { bool: { filter } },
    sort: [{ slug: 'asc' }, { id: 'asc' }],
    ...(after ? { search_after: after } : {}),
  };
}

export function placeLookupRequest(slug: string): SearchRequest {
  return {
    index: REGIONS_INDEX,
    size: 1,
    track_total_hits: false,
    _source: [...SUMMARY_FIELDS, 'fips', 'lsad', 'centroid', 'geometry'],
    query: {
      bool: { filter: [{ term: { type: 'place' } }, { term: { slug } }] },
    },
  };
}

export function encodePlaceCursor(
  state: string | undefined,
  slug: string,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify({ state: state ?? null, slug, id }),
  ).toString('base64url');
}

function decodeCursor(
  cursor: string,
  state: string | undefined,
): [string, string] {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      typeof value === 'object' &&
      value !== null &&
      'state' in value &&
      'slug' in value &&
      'id' in value &&
      value.state === (state ?? null) &&
      typeof value.slug === 'string' &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) &&
      typeof value.id === 'string' &&
      /^place:[0-9]{7}$/.test(value.id)
    )
      return [value.slug, value.id];
  } catch {
    // Invalid cursor, handled below.
  }
  throw new BadRequestException('Invalid cursor for this state filter');
}

export function placeSummary(source: PlaceSource): PlaceSummaryDto {
  return {
    id: source.id,
    name: source.name,
    state: source.state,
    slug: source.slug,
    place_type: source.place_type,
  };
}

export function placeDetail(source: PlaceSource): PlaceDetailDto {
  const [lng, lat] = source.centroid;
  return {
    ...placeSummary(source),
    type: 'place',
    fips: source.fips,
    lsad: source.lsad,
    centroid: { lat, lng },
    bbox: geometryBounds(source.geometry),
    geometry: source.geometry,
  };
}

function geometryBounds(
  geometry: Record<string, unknown>,
): [number, number, number, number] {
  if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') {
    throw new BadGatewayException('Invalid published Place geometry');
  }
  const bounds: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ];
  const visit = (value: unknown): void => {
    if (!Array.isArray(value) || value.length === 0)
      throw new BadGatewayException('Invalid published Place geometry');
    if (
      typeof value[0] === 'number' &&
      typeof value[1] === 'number' &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1])
    ) {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
    } else {
      for (const child of value) visit(child);
    }
  };
  visit(geometry.coordinates);
  return bounds;
}
