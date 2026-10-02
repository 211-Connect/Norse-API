import { ApiProperty } from '@nestjs/swagger';
import { Geometry } from 'geojson';
import { ShardsInfo } from '../types';

export type SearchFacet = {
  key: string;
  name: { en: string; locale: string };
  values: Array<{ en: string; locale: string; doc_count: number }>;
};

// Per-document facet values: language -> array of values
// Example: { area_served_by_county: { en: ['Dakota County'], es: ['Condado de Dakota'] } }
export type DocumentFacets = Record<string, Record<string, string[]>>;

export class ServiceDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  alert?: string | null;

  @ApiProperty({ nullable: true })
  alert_date?: string | null;

  @ApiProperty({ nullable: true })
  alternate_name?: string | null;

  @ApiProperty({ nullable: true })
  description?: string | null;

  @ApiProperty({ nullable: true })
  summary?: string | null;

  @ApiProperty({ nullable: true })
  eligibility?: string | null;

  @ApiProperty({ nullable: true })
  application_process?: string | null;
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
  @ApiProperty({ nullable: true })
  id?: string | null;

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

  @ApiProperty()
  attribution?: string;
}

export class SearchHit {
  @ApiProperty()
  _index: string;

  @ApiProperty({ required: false })
  _id?: string;

  @ApiProperty({ nullable: true, required: false })
  _score?: number | null;

  @ApiProperty({ nullable: true })
  _routing?: string | null;

  @ApiProperty({ type: SearchSource, required: false })
  _source?: SearchSource;

  @ApiProperty({ type: [Number], nullable: true })
  sort?: number[] | null;
}

export class SearchHitsContainer {
  @ApiProperty({ example: { value: 100, relation: 'eq' } })
  total?: { value: number; relation: string } | number;

  @ApiProperty({ nullable: true })
  max_score?: number | null;

  @ApiProperty({ type: [SearchHit] })
  hits: SearchHit[];
}

/**
 * Present only when the caller opted in with `relevance_cutoff`. Absent from
 * every response that did not ask for it, so an existing consumer sees an
 * unchanged document.
 */
export class RelevanceCutoffDto {
  @ApiProperty({
    description:
      'Whether results were actually removed. `false` means the strategy ran ' +
      'and declined to cut — not that it failed.',
  })
  applied: boolean;

  @ApiProperty({
    nullable: true,
    enum: ['no_elbow', 'below_min_keep', 'cut_too_large'],
    description:
      'Why nothing was cut, when `applied` is false. `no_elbow`: nothing ' +
      'scored meaningfully below the threshold, so the distribution is flat ' +
      'and returning everything is the honest answer. `below_min_keep`: the ' +
      'matched set is already smaller than the floor. `cut_too_large`: the ' +
      'cut point was located exactly, but keeps more results than are worth ' +
      'enumerating, so nothing was trimmed — "found it, too big", not ' +
      '"could not find it".',
  })
  reason?: 'no_elbow' | 'below_min_keep' | 'cut_too_large' | null;

  @ApiProperty({
    description:
      'Results kept. Equals `matched_before_cutoff` when `applied` is false.',
  })
  kept: number;

  @ApiProperty({
    description:
      'Results the query matched before trimming — the number `hits.total` ' +
      'would have reported with `relevance_cutoff=off`. Kept on the wire ' +
      'because a cutoff hides results rather than reordering them; a ' +
      'consumer needs to be able to say "18 of 1,200 shown".',
  })
  matched_before_cutoff: number;

  @ApiProperty({
    nullable: true,
    description:
      'Score of the last kept result **on the cutoff probe’s scale, which ' +
      'is not the scale of `_score` in `hits`**. The probe ranks on semantic ' +
      'and lexical signal only — it omits the distance decay (0–25 ' +
      'points) and the priority boost that the main query adds — so this ' +
      'value is systematically lower than the score of the same document in ' +
      'the response, and the two must not be compared. It is comparable ' +
      'across responses, which is what it is for: evaluating the shipped ' +
      'threshold retroactively against real traffic.',
  })
  cutoff_score?: number | null;

  @ApiProperty({
    description:
      'How many results scored above the threshold — the size of the cut ' +
      'that was located, whether or not it was applied. Counted over the ' +
      'whole matched set, not a fixed window.',
  })
  candidates_examined: number;
}

export class SearchResponseDto {
  @ApiProperty({ type: SearchHitsContainer })
  search: {
    took: number;
    timed_out: boolean;
    _shards: ShardsInfo;
    hits: SearchHitsContainer;
  };

  @ApiProperty()
  facets: SearchFacet[];

  @ApiProperty({ type: RelevanceCutoffDto, required: false, nullable: true })
  relevance_cutoff?: RelevanceCutoffDto;
}

export type SearchResponse = SearchResponseDto;
