import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import {
  DocumentFacets,
  OrganizationDto,
  PhysicalAddressDto,
  SearchResponseDto,
  ServiceDto,
  TaxonomyDto,
} from '../../../search/dto/search-response.dto';
import { ShardsInfo } from '../../../search/types';

// The v1 response DTOs describe the v1 document and feed the frontend SDK, so
// they stay as they are. The classes below describe what /v2/search returns,
// checked against real answers. They feed the standalone v2 OpenAPI document
// (`npm run openapi:v2-search`) only.

export class V2TaxonomyDto extends TaxonomyDto {
  @ApiProperty({ type: [String], description: 'Earlier AIRS/211 codes.' })
  old_codes?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Other names for the term.',
  })
  use_references?: string[];

  @ApiPropertyOptional({
    description: 'Related terms: a code and a name each.',
    type: 'array',
    items: {
      type: 'object',
      properties: { code: { type: 'string' }, name: { type: 'string' } },
    },
  })
  see_also_references?: { code: string; name: string }[];
}

export class V2PhysicalAddressDto extends PhysicalAddressDto {
  @ApiPropertyOptional({ example: 'physical' })
  type?: string;
}

export class V2PointDto {
  @ApiProperty({ enum: ['Point'] })
  type: 'Point';

  @ApiProperty({
    type: [Number],
    minItems: 2,
    maxItems: 2,
    description: 'Longitude, then latitude.',
  })
  coordinates: [number, number];
}

export class V2LocationDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  alternate_name?: string | null;

  @ApiProperty({ nullable: true })
  description?: string | null;

  @ApiProperty({ nullable: true })
  summary?: string | null;

  @ApiProperty({
    type: V2PointDto,
    nullable: true,
    description: 'GeoJSON point.',
  })
  point?:
    | V2PointDto
    | { lat: number; lon: number }
    | [number, number]
    | string
    | null;

  @ApiProperty({ type: V2PhysicalAddressDto, nullable: true })
  physical_address?: V2PhysicalAddressDto | null;
}

export class V2SearchSourceDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ format: 'uuid' })
  service_at_location_id: string;

  @ApiProperty({ format: 'uuid' })
  service_id?: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  service_area_id?: string | null;

  @ApiProperty({ format: 'uuid' })
  tenant_id: string;

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

  @ApiProperty({ type: ServiceDto })
  service: ServiceDto;

  @ApiProperty({ type: V2LocationDto })
  location: V2LocationDto;

  @ApiProperty({ type: OrganizationDto })
  organization: OrganizationDto;

  @ApiProperty({ type: [V2TaxonomyDto] })
  taxonomies: V2TaxonomyDto[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Per-document facet values. Often empty.',
  })
  facets: DocumentFacets;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Taxonomy code to display names, per language. Often empty.',
  })
  taxonomy_names?: Record<string, unknown>;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Tenant attribute values. Often empty.',
  })
  attribute_values?: Record<string, unknown>;

  @ApiProperty({ type: Number, nullable: true })
  minimum_age?: number | null;

  @ApiProperty({ type: Number, nullable: true })
  maximum_age?: number | null;

  @ApiProperty()
  priority: number;

  @ApiProperty()
  pinned: boolean;

  @ApiProperty({
    description: 'Source of the listing, for example a 211 name.',
  })
  attribution?: string;
}

export class V2SearchHitDto {
  @ApiProperty({ example: 'hybrid_search_resources_en_v1' })
  _index: string;

  @ApiProperty()
  _id?: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Relevance score. null on a text search (the hybrid ranking sorts on a script). A number on a browse (no text).',
  })
  _score?: number | null;

  @ApiProperty({ type: V2SearchSourceDto })
  _source?: V2SearchSourceDto;

  @ApiPropertyOptional({
    type: 'array',
    items: { oneOf: [{ type: 'number' }, { type: 'string' }] },
    description:
      'Sort values. Present on a browse (no text): a number, then the result id.',
  })
  sort?: (number | string)[] | null;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Need codes sent in `needs` that this service matches, in sent order. Present only when the request sent `needs`.',
  })
  matched_needs?: string[];
}

export class V2HitsTotalDto {
  @ApiProperty({ example: 29127 })
  value: number;

  @ApiProperty({ enum: ['eq', 'gte'] })
  relation: string;
}

export class V2SearchHitsDto {
  @ApiProperty({ type: V2HitsTotalDto })
  total?: V2HitsTotalDto | number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'null on a text search; the top score on a browse.',
  })
  max_score?: number | null;

  @ApiProperty({ type: [V2SearchHitDto] })
  hits: V2SearchHitDto[];
}

export class V2SearchBodyDto {
  @ApiProperty({ description: 'Elasticsearch time in ms.' })
  took: number;

  @ApiProperty()
  timed_out: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Elasticsearch shard counts.',
  })
  _shards: ShardsInfo;

  @ApiProperty({ type: V2SearchHitsDto })
  hits: V2SearchHitsDto;
}

export class V2FacetNameDto {
  @ApiProperty()
  en: string;

  @ApiProperty()
  locale: string;
}

export class V2FacetValueDto extends V2FacetNameDto {
  @ApiProperty()
  doc_count: number;
}

export class V2FacetDto {
  @ApiProperty()
  key: string;

  @ApiProperty({ type: V2FacetNameDto })
  name: V2FacetNameDto;

  @ApiProperty({ type: [V2FacetValueDto] })
  values: V2FacetValueDto[];
}

/** Error body of the global exception filter, as the 400 answers show it. */
export class V2ErrorDto {
  @ApiProperty({ example: 400 })
  status: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    description:
      'One message, or a list when several validators failed (for example `limit must not be less than 25`).',
  })
  message: string | string[];

  @ApiProperty({ example: '/v2/search?query=food' })
  path: string;

  @ApiProperty({ example: 'GET' })
  method: string;

  @ApiPropertyOptional({
    description: 'The tenant id. Absent when the tenant header failed.',
  })
  tenant?: string;
}

export class V2IntentNeedDto {
  @ApiProperty({ example: 'N-HOU-02', description: 'SUNE need code.' })
  value: string;

  @ApiProperty({ enum: ['caller', 'inferred'] })
  source: 'caller' | 'inferred';

  @ApiProperty({
    enum: ['use', 'ask'],
    description: '`use` boosts results. `ask` is offered as a question option.',
  })
  state: 'use' | 'ask';

  @ApiPropertyOptional({ description: 'Model score; inferred needs only.' })
  confidence?: number;

  @ApiPropertyOptional({
    description:
      'The spoken description of the need (ADR 0039 Decision 31), same text as `description` on a question option.',
  })
  description?: string;
}

export class V2IntentUrgencyDto {
  @ApiProperty({ enum: ['U-0', 'U-1', 'U-2', 'U-3', 'U-4', 'U-X'] })
  value: string;

  @ApiProperty({ enum: ['caller', 'inferred', 'default'] })
  source: 'caller' | 'inferred' | 'default';

  @ApiProperty({ enum: ['use', 'ask', 'drop'] })
  state: 'use' | 'ask' | 'drop';
}

export class V2IntentTaxonomyDto {
  @ApiProperty({ example: 'BD-1800', description: 'HSIS taxonomy code.' })
  value: string;

  @ApiProperty({ enum: ['caller'] })
  source: 'caller';
}

export class V2IntentDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The typed query when it is a string with text, else null.',
  })
  query: string | null;

  @ApiPropertyOptional({
    type: [V2IntentTaxonomyDto],
    description:
      'The `taxonomy` codes the request sent, as sent (not expanded to child codes). Absent when none were sent.',
  })
  taxonomy?: V2IntentTaxonomyDto[];

  @ApiProperty({ type: [V2IntentNeedDto] })
  needs: V2IntentNeedDto[];

  @ApiProperty({ type: V2IntentUrgencyDto })
  urgency: V2IntentUrgencyDto;
}

/** One answer. A pick adds `value` to the URL parameter `parameter` (ADR 0039 Decision 55). */
export class V2QuestionOptionDto {
  @ApiProperty({ example: 'Help paying rent' })
  label: string;

  @ApiPropertyOptional({
    example: 'You may be behind on rent, or you got an eviction notice.',
    description:
      'Need options only: the spoken description of the need (ADR 0039 Decision 31), for the tenant and language of the request. Absent on urgency and emergency options.',
  })
  description?: string;

  @ApiProperty({
    enum: ['needs', 'passed_needs', 'urgency'],
    nullable: true,
    description:
      'The URL parameter that a pick of this option adds. One question can mix kinds. null (with value null): the pick writes nothing to the URL (no option uses it today).',
  })
  parameter: 'needs' | 'passed_needs' | 'urgency' | null;

  @ApiProperty({
    nullable: true,
    example: 'N-HOU-02',
    description:
      'The value added to that parameter, for example N-HOU-02 or U-0; null when parameter is null.',
  })
  value: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Services that match this option; null when the server did not count (all urgency options, and need options when no count ran). A counted option keeps its number. An option with count 0 is never offered.',
  })
  // Optional in TS only: the rules engine's finalize always sets it (null when not counted).
  results_count?: number | null;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 1.3,
    description:
      'Need options only. Formula: classifier confidence for the need (0 when the model gave none) + 0.3 * log(1 + count) / log(1 + max count among this question\'s options). A null count adds 0; a count of 0 adds 0 and the option stays listed. The score can pass 1 (up to confidence + 0.3). Options are sorted by it, high to low; ties keep vocabulary order. The page shows the top ones and puts the rest under "Show more". Absent on urgency options.',
  })
  score?: number;
}

export class V2HotlineDto {
  @ApiProperty()
  label: string;

  @ApiProperty()
  number: string;
}

export class V2QuestionDto {
  @ApiProperty() id: string;
  @ApiProperty({
    enum: ['emergency', 'confirm_urgency', 'find_need', 'narrow'],
  })
  type: string;
  @ApiProperty({ enum: ['critical', 'high', 'medium', 'low'] })
  importance: string;
  @ApiProperty() value: number;
  @ApiProperty() priority: number;
  @ApiProperty() uncertainty: number;
  @ApiProperty() reason: string;
  @ApiProperty() step: number;
  @ApiProperty() stem: string;
  @ApiProperty({
    type: [V2QuestionOptionDto],
    description:
      'Emergency question: "Yes" adds `urgency=U-0`; the two "No, I am safe" answers add `urgency=U-1` (help today) or `urgency=U-2` (help within a week); empty for a caller `urgency=U-0`.',
  })
  options: V2QuestionOptionDto[];
  @ApiProperty() multi_select: boolean;
  @ApiProperty() allow_other: boolean;
  @ApiProperty() none_of_these: boolean;
  @ApiPropertyOptional({
    type: [V2HotlineDto],
    description: 'Emergency question only. One tap calls a number.',
  })
  hotlines?: V2HotlineDto[];
}

export class V2NoticeDto {
  @ApiProperty({ enum: ['may_not_match'] })
  kind: 'may_not_match';

  @ApiProperty() text: string;
}

export class V2ClarificationDto {
  @ApiProperty() rules_version: string;

  @ApiProperty({ type: [V2QuestionDto], description: 'At most 3, ranked.' })
  questions: V2QuestionDto[];

  @ApiPropertyOptional({
    type: V2NoticeDto,
    description:
      'Set only when the text has no clear need and the hits do not hold the query words (rule R5): the results may not match.',
  })
  notice?: V2NoticeDto;

  @ApiPropertyOptional({
    type: V2HotlineDto,
    description:
      'A number to call. Set when the search has no results (weak match or zero results) and in rule R5.',
  })
  phone_line?: V2HotlineDto;
}

/**
 * Draft until the v2 ADR (ISS-2493). No top-level emergency block: the
 * emergency is only the emergency question in `clarification` (ADR 0039
 * Decision 54).
 */
export class V2SearchResponseDto extends OmitType(SearchResponseDto, [
  'search',
  'facets',
] as const) {
  @ApiProperty({ type: V2SearchBodyDto })
  search: {
    took: number;
    timed_out: boolean;
    _shards: ShardsInfo;
    hits: V2SearchHitsDto;
  };

  @ApiProperty({
    type: [V2FacetDto],
    description: 'Empty unless the tenant defines facets.',
  })
  facets: V2FacetDto[];

  @ApiProperty({
    description:
      'True when the text found no good match (ISS-2796). Without `needs` the results are empty and `clarification` asks what the person needs; with `needs` the results are the services that carry those needs, ranked without the text.',
  })
  weak_match: boolean;
  @ApiProperty({ type: V2IntentDto }) intent: V2IntentDto;
  @ApiProperty({ type: V2ClarificationDto }) clarification: V2ClarificationDto;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when classification was skipped or failed.',
  })
  model_version: string | null;
  @ApiProperty() rules_version: string;
}
