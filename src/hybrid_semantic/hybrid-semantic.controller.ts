import { Controller, Post, Body, Version } from '@nestjs/common';
import {
  ApiTags,
  ApiHeader,
  ApiResponse,
  ApiOperation,
  ApiBody,
} from '@nestjs/swagger';
import { HybridSemanticService } from './hybrid-semantic.service';
import {
  SearchRequestDto,
  searchRequestSchema,
} from './dto/search-request.dto';
import { SearchResponse } from './dto/search-response.dto';
import { ZodValidationPipe } from 'src/common/pipes/zod-validation-pipe';
import { CustomHeaders } from 'src/common/decorators/CustomHeaders';
import { Tenant } from 'src/common/decorators/Tenant';
import { HeadersDto, headersSchema } from 'src/common/dto/headers.dto';
import { Request } from 'express';

/**
 * Controller for hybrid semantic search endpoints
 * Combines semantic search, keyword search, and intent-driven taxonomy queries
 */
@ApiTags('Hybrid Semantic Search')
@Controller('hybrid-semantic')
@ApiHeader({
  name: 'x-api-version',
  description: 'API version',
  required: true,
  schema: {
    default: '1',
  },
})
@ApiHeader({
  name: 'x-tenant-id',
  description: 'Tenant identifier',
  required: true,
})
@ApiHeader({
  name: 'accept-language',
  description: 'Language preference (e.g., en, es)',
  schema: {
    default: 'en',
  },
})
export class HybridSemanticController {
  constructor(private readonly hybridSemanticService: HybridSemanticService) {}

  @Post('search')
  @Version('1')
  @ApiBody({
    description: 'Search request with optional custom weights for fine-tuning',
    schema: {
      type: 'object',
      required: ['q'],
      properties: {
        q: {
          type: 'string',
          description: 'Search query text',
          example: 'food assistance near me',
        },
        lang: {
          type: 'string',
          description: 'Language code',
          default: 'en',
          example: 'en',
        },
        limit: {
          type: 'integer',
          description: 'Number of results to return (1-100)',
          default: 10,
          minimum: 1,
          maximum: 100,
          example: 20,
        },
        lat: {
          type: 'number',
          description: 'User latitude for geospatial search',
          example: 47.6062,
        },
        lon: {
          type: 'number',
          description: 'User longitude for geospatial search',
          example: -122.3321,
        },
        distance: {
          type: 'integer',
          description:
            'Maximum distance in miles (hard filter - excludes results beyond this)',
          example: 50,
        },
        search_after: {
          type: 'array',
          description: 'Cursor for pagination (from previous response)',
          items: { type: 'any' },
          example: [0.95, 'resource-123'],
        },
        query: {
          type: 'object',
          description: 'Advanced taxonomy query with AND/OR logic',
          properties: {
            AND: {
              type: 'array',
              items: { type: 'string' },
              description: 'All taxonomy codes must match',
              example: ['BD-1800', 'BD-1801'],
            },
            OR: {
              type: 'array',
              items: { type: 'string' },
              description: 'Any taxonomy code can match',
              example: ['BD-1800', 'LR-8500'],
            },
          },
        },
        facets: {
          type: 'object',
          description: 'Facet filters (OR within field, AND across fields)',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
          example: {
            service_type: ['emergency', 'ongoing'],
            eligibility: ['low_income'],
          },
        },
        location_point_only: {
          type: 'boolean',
          description: 'Only return results with valid location coordinates',
          default: false,
        },
        keyword_search_only: {
          type: 'boolean',
          description: 'Use only keyword search (disable semantic search)',
          default: false,
        },
        search_operator: {
          type: 'string',
          enum: ['AND', 'OR'],
          description: 'Operator for keyword search',
          default: 'AND',
        },
        exclude_service_area: {
          type: 'boolean',
          description: 'Exclude service area polygons from response',
          default: false,
        },
        intent_override: {
          type: 'string',
          description: 'Override automatic intent classification',
          example: 'food_assistance',
        },
        disable_intent_classification: {
          type: 'boolean',
          description: 'Disable intent classification and taxonomy matching',
          default: false,
        },
        custom_weights: {
          type: 'object',
          description:
            'Fine-tune scoring weights for all search components. Weights are multipliers, not percentages - they do NOT need to add up to 100%. Higher values give more importance to that component. Range: 0-10 for all weights.',
          properties: {
            semantic: {
              type: 'object',
              description:
                'Weights for semantic search sub-strategies (0-10). Controls importance of different embedding fields.',
              properties: {
                service: {
                  type: 'number',
                  description:
                    'Weight for service-level semantic search. Higher values prioritize matches on service names/descriptions.',
                  minimum: 0,
                  maximum: 10,
                  default: 1.0,
                  example: 2.0,
                },
                taxonomy: {
                  type: 'number',
                  description:
                    'Weight for taxonomy-level semantic search. Higher values prioritize matches on taxonomy classifications.',
                  minimum: 0,
                  maximum: 10,
                  default: 1.0,
                  example: 1.5,
                },
                organization: {
                  type: 'number',
                  description:
                    'Weight for organization-level semantic search. Higher values prioritize matches on organization names.',
                  minimum: 0,
                  maximum: 10,
                  default: 1.0,
                  example: 1.0,
                },
              },
            },
            strategies: {
              type: 'object',
              description:
                'Weights for overall search strategies (0-10). Controls balance between different search approaches.',
              properties: {
                semantic_search: {
                  type: 'number',
                  description:
                    'Weight for all semantic search strategies combined. Multiplies semantic sub-weights. Set to 0 to disable semantic search.',
                  minimum: 0,
                  maximum: 10,
                  default: 1.0,
                  example: 1.5,
                },
                keyword_search: {
                  type: 'number',
                  description:
                    'Weight for keyword/text search. Higher values prioritize exact text matches over semantic similarity.',
                  minimum: 0,
                  maximum: 10,
                  default: 1.0,
                  example: 0.8,
                },
                intent_driven: {
                  type: 'number',
                  description:
                    'Weight for intent-driven taxonomy search. Higher values prioritize AI-classified taxonomy matches.',
                  minimum: 0,
                  maximum: 10,
                  default: 1.0,
                  example: 1.2,
                },
              },
            },
            geospatial: {
              type: 'object',
              description:
                'Geospatial proximity scoring configuration. Controls how distance affects ranking within the filtered area.',
              properties: {
                weight: {
                  type: 'number',
                  description:
                    'Multiplier for geospatial score. Higher values make proximity more important. Set to 0 to ignore distance in ranking.',
                  minimum: 0,
                  maximum: 10,
                  default: 2.0,
                  example: 3.0,
                },
                decay_scale: {
                  type: 'number',
                  description:
                    'Distance in miles where geospatial score drops to 50%. Smaller values = stronger proximity preference (within distance filter).',
                  minimum: 1,
                  maximum: 200,
                  default: 50,
                  example: 25,
                },
                decay_offset: {
                  type: 'number',
                  description:
                    'Distance in miles before decay starts. Results within this distance get full geospatial score.',
                  minimum: 0,
                  maximum: 50,
                  default: 0,
                  example: 5,
                },
              },
            },
          },
          example: {
            semantic: {
              service: 2.0,
              taxonomy: 1.5,
              organization: 1.0,
            },
            strategies: {
              semantic_search: 1.5,
              keyword_search: 0.8,
              intent_driven: 1.2,
            },
            geospatial: {
              weight: 3.0,
              decay_scale: 25,
              decay_offset: 5,
            },
          },
        },
      },
      example: {
        q: 'food assistance',
        lat: 47.6062,
        lon: -122.3321,
        distance: 50,
        limit: 20,
        search_after: [0.95, 'resource-123'],
        custom_weights: {
          semantic: {
            service: 2.0,
            taxonomy: 1.5,
          },
          strategies: {
            keyword_search: 0.8,
          },
          geospatial: {
            weight: 3.0,
            decay_scale: 25,
          },
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Execute hybrid semantic search',
    description: `
      Advanced search endpoint combining multiple strategies:
      - Semantic search using embeddings (service, taxonomy, organization)
      - Keyword search across text fields
      - Intent-driven taxonomy queries with AND/OR logic
      - Geospatial proximity weighting (distance decay scoring)
      - AI-powered reranking
      - Cursor-based pagination via search_after
      
      The search pipeline:
      1. Query embedding and intent classification (parallel)
      2. Multi-strategy OpenSearch query (_msearch) with geospatial scoring
      3. Result reranking via ai-utils microservice
      4. Post-processing and response preparation
      
      Custom Weights (custom_weights object):
      - Fine-tune scoring with granular control over all search components
      - Semantic sub-weights: service, taxonomy, organization (0-10)
      - Strategy weights: semantic_search, keyword_search, intent_driven (0-10)
      - Geospatial: weight, decay_scale, decay_offset
      - Example: { "custom_weights": { "semantic": { "service": 2.0, "taxonomy": 1.5 }, "strategies": { "keyword_search": 0.5 }, "geospatial": { "weight": 3.0, "decay_scale": 25 } } }
      
      Geospatial Filtering & Weighting:
      - 'distance' parameter: Hard filter (excludes results beyond X miles)
      - Proximity scoring: Gaussian decay within the filtered radius
      - Nearer results receive higher scores when semantic relevance is equal
      - Configure decay via custom_weights.geospatial (decay_scale, decay_offset, weight)
      - Example: distance=50 filters to 50mi, decay_scale=25 means score drops to 50% at 25mi
      
      Pagination:
      - Use the 'limit' parameter to control page size (max 100)
      - Use 'search_after' from the response to fetch the next page
      - The 'search_after' array contains [score, id] for cursor-based pagination
      - Maintain the same query parameters across paginated requests
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Search results with metadata',
    schema: {
      example: {
        took: 245,
        timed_out: false,
        hits: {
          total: {
            value: 10,
            relation: 'eq',
          },
          max_score: 0.95,
          hits: [
            {
              _index: 'tenant-resources_en',
              _id: 'resource-123',
              _score: 0.95,
              _source: {
                id: 'resource-123',
                name: 'Food Bank Services',
                description: 'Provides emergency food assistance',
                service: {
                  name: 'Emergency Food',
                  description: 'Free food distribution',
                },
                organization: {
                  name: 'Community Food Bank',
                },
                taxonomies: [
                  {
                    code: 'BD-1800',
                    name: 'Food Banks',
                  },
                ],
                location: {
                  name: 'Main Location',
                  point: {
                    lat: 47.751076,
                    lon: -120.740135,
                  },
                },
                distance_from_user: 12.5, // Distance in miles from user location
              },
            },
          ],
        },
        search_after: [0.95, 'resource-123'],
        metadata: {
          search_pipeline: 'hybrid_semantic',
          intent_classification: {
            intent: 'food_assistance',
            confidence: 0.92,
          },
          phase_timings: {
            embedding_and_classification: 45,
            opensearch_query: 120,
            reranking: 65,
            post_processing: 15,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters',
  })
  async search(
    @CustomHeaders(new ZodValidationPipe(headersSchema)) headers: HeadersDto,
    @Body(new ZodValidationPipe(searchRequestSchema)) body: SearchRequestDto,
    @Tenant() tenant: Request['tenant'],
  ): Promise<SearchResponse> {
    return this.hybridSemanticService.search(body, headers, tenant);
  }
}
