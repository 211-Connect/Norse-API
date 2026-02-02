import { ApiProperty } from '@nestjs/swagger';
import { Geometry } from 'geojson';

// Top-level facets mapping (facet key -> human-readable name object)
export type SearchFacets = Record<string, Record<string, string>>;

// Per-document facet values: language -> array of values
// Example: { area_served_by_county: { en: ['Dakota County'], es: ['Condado de Dakota'] } }
export type DocumentFacets = Record<string, Record<string, string[]>>;

export class ServiceDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  alternate_name?: string | null;

  @ApiProperty({ nullable: true })
  description?: string | null;

  @ApiProperty({ nullable: true })
  summary?: string | null;
}

export class PhysicalAddressDto {
  @ApiProperty({ nullable: true })
  address_1?: string | null;

  @ApiProperty({ nullable: true })
  address_2?: string | null;

  @ApiProperty({ nullable: true })
  city?: string | null;

  @ApiProperty({ nullable: true })
  state?: string | null;

  @ApiProperty({ nullable: true })
  country?: string | null;

  @ApiProperty({ nullable: true })
  postal_code?: string | null;
}

export class LocationDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  alternate_name?: string | null;

  @ApiProperty({ nullable: true })
  description?: string | null;

  @ApiProperty({ nullable: true })
  summary?: string | null;

  @ApiProperty({ nullable: true })
  point?: { lat: number; lon: number } | [number, number] | string | null;

  @ApiProperty({ type: PhysicalAddressDto, nullable: true })
  physical_address?: PhysicalAddressDto | null;
}

export class OrganizationDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  alternate_name?: string | null;

  @ApiProperty({ nullable: true })
  description?: string | null;

  @ApiProperty({ nullable: true })
  summary?: string | null;
}

export class TaxonomyDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  description?: string | null;
}

export class SearchSource {
  @ApiProperty()
  id: string;

  @ApiProperty()
  service_at_location_id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  description?: string | null;

  @ApiProperty({ nullable: true })
  summary?: string | null;

  @ApiProperty({ nullable: true })
  phone?: string | null;

  @ApiProperty({ nullable: true })
  url?: string | null;

  @ApiProperty({ nullable: true })
  email?: string | null;

  @ApiProperty({ nullable: true })
  schedule?: string | null;

  @ApiProperty({ nullable: true })
  service_area?: Geometry | null;

  @ApiProperty({ type: ServiceDto })
  service: ServiceDto;

  @ApiProperty({ type: LocationDto })
  location: LocationDto;

  @ApiProperty({ type: OrganizationDto })
  organization: OrganizationDto;

  @ApiProperty({ type: [TaxonomyDto] })
  taxonomies: TaxonomyDto[];

  @ApiProperty()
  facets: DocumentFacets;

  @ApiProperty()
  tenant_id: string;

  @ApiProperty()
  priority: number;

  @ApiProperty()
  pinned: boolean;
}

export class SearchHit {
  @ApiProperty()
  _index: string;

  @ApiProperty()
  _id: string;

  @ApiProperty({ nullable: true })
  _score: number | null;

  @ApiProperty({ nullable: true })
  _routing?: string | null;

  @ApiProperty({ type: SearchSource })
  _source: SearchSource;

  @ApiProperty({ type: [Number], nullable: true })
  sort?: number[] | null;
}

export class SearchHitsContainer {
  @ApiProperty({ example: { value: 100, relation: 'eq' } })
  total: { value: number; relation: string };

  @ApiProperty({ nullable: true })
  max_score: number | null;

  @ApiProperty({ type: [SearchHit] })
  hits: SearchHit[];
}

export class SearchResponseDto {
  @ApiProperty({ type: SearchHitsContainer })
  search: {
    took: number;
    timed_out: boolean;
    _shards: {
      total: number;
      successful: number;
      skipped: number;
      failed: number;
    };
    hits: SearchHitsContainer;
  };

  @ApiProperty()
  facets: SearchFacets;

  @ApiProperty({ required: false })
  facets_values?: DocumentFacets;
}

export type SearchResponse = SearchResponseDto;
