import { ApiProperty } from '@nestjs/swagger';

/**
 * Represents a taxonomy document from the taxonomies_v2 Elasticsearch index
 */
export interface TaxonomyDocument {
  /** Taxonomy name (search_as_you_type field) */
  name: string;

  /** Taxonomy description */
  description?: string;

  /** Taxonomy ID (non-indexed text field) */
  id: string;

  /** Taxonomy classification/category */
  taxonomy?: string;

  /** Tenant identifier */
  tenant_id: string;

  /** Taxonomy code (search_as_you_type with raw keyword) */
  code: string;

  /** Type of taxonomy entry */
  type?: string;

  /** Creation timestamp */
  created_at: string | Date;

  /** Last update timestamp */
  updated_at: string | Date;
}

/**
 * Elasticsearch search hit for taxonomy documents
 */
export interface TaxonomyHit {
  _index: string;
  _id?: string;
  _score?: number | null;
  _source?: TaxonomyDocument;
}

/**
 * Response from taxonomy search operations
 * Aligned with Elasticsearch SearchResponse structure
 */
export interface TaxonomySearchResponse {
  hits: {
    total?:
      | number
      | {
          value: number;
          relation: string;
        };
    max_score?: number | null;
    hits: TaxonomyHit[];
  };
  took?: number;
  timed_out?: boolean;
  _shards?: {
    total: number;
    successful: number;
    skipped?: number;
    failed: number;
  };
  aggregations?: Record<string, any>;
}

export class TaxonomyItemDto {
  @ApiProperty({
    description: 'Unique identifier of the taxonomy term',
    example: 'ee9dd652-19d7-5226-bd7c-3c01f8144f2a',
  })
  id: string;

  @ApiProperty({
    description: 'Taxonomy code',
    example: 'FT-2700.9500',
  })
  code: string;

  @ApiProperty({
    description: 'Taxonomy term name',
    example: 'Will Preparation Assistance',
  })
  name: string;
}

export class TaxonomyResponseDto {
  @ApiProperty({
    description: 'Total number of matching results',
    example: 40,
  })
  total: number;

  @ApiProperty({
    description: 'Array of taxonomy items',
    type: [TaxonomyItemDto],
  })
  items: TaxonomyItemDto[];

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;
}
