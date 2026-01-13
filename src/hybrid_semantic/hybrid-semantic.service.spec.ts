import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { HybridSemanticService } from './hybrid-semantic.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { OpenSearchService } from './services/opensearch.service';
import { WeightsConfigService } from './config/weights-config.service';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import axios from 'axios';

// Mock axios for external HTTP calls
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock the OpenSearch client
jest.mock('@opensearch-project/opensearch', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      search: jest.fn(),
      msearch: jest.fn(),
      cluster: {
        health: jest.fn(),
      },
    })),
  };
});

// Mock NlpUtilsService to avoid wink-nlp initialization issues in tests
jest.mock('src/common/services/nlp-utils.service', () => {
  return {
    NlpUtilsService: jest.fn().mockImplementation(() => ({
      extractNouns: jest.fn(() => ['test', 'noun']),
      stemQueryForSuggestion: jest.fn((text) => text.toLowerCase()),
    })),
  };
});

describe('HybridSemanticService', () => {
  let service: HybridSemanticService;
  let aiUtilsService: AiUtilsService;
  let openSearchService: OpenSearchService;

  beforeEach(async () => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Set up environment variables for ConfigService
    process.env.OPENSEARCH_NODE = 'http://localhost:9200';
    process.env.AI_UTILS_URL = 'http://localhost:8000';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'bge-m3:567m';

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
      ],
      providers: [
        HybridSemanticService,
        AiUtilsService,
        OpenSearchService,
        WeightsConfigService,
        NlpUtilsService,
      ],
    }).compile();

    service = module.get<HybridSemanticService>(HybridSemanticService);
    aiUtilsService = module.get<AiUtilsService>(AiUtilsService);
    openSearchService = module.get<OpenSearchService>(OpenSearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Clean up environment variables
    delete process.env.OPENSEARCH_NODE;
    delete process.env.AI_UTILS_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_EMBEDDING_MODEL;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search', () => {
    it('should execute full hybrid semantic search pipeline', async () => {
      // Mock axios responses for embedQuery and classifyQuery
      const mockEmbedding = new Array(1024).fill(0.1);
      const mockClassification = {
        primary_intent: 'food_assistance',
        confidence: 'high',
        is_low_information_query: false,
        combined_taxonomy_codes: ['BD-1800'],
        top_intents: [],
        priority_rule_applied: false,
      };

      // Mock embedding response
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: [{ embedding: mockEmbedding, index: 0 }],
          model: 'bge-m3:567m',
        },
      });

      // Mock classification response
      mockedAxios.post.mockResolvedValueOnce({
        data: mockClassification,
      });

      // Mock OpenSearch results
      const mockOpenSearchResults = [
        {
          _id: 'resource-1',
          _score: 0.95,
          _source: {
            id: 'resource-1',
            name: 'Food Pantry',
            description: 'Provides food assistance',
            taxonomies: [
              {
                code: 'BD-1800',
                name: 'Food Pantries',
              },
            ],
          },
        },
        {
          _id: 'resource-2',
          _score: 0.88,
          _source: {
            id: 'resource-2',
            name: 'Emergency Food',
            description: 'Emergency food services',
            taxonomies: [
              {
                code: 'BD-1800.1500',
                name: 'Emergency Food',
              },
            ],
          },
        },
      ];

      jest.spyOn(openSearchService, 'executeHybridSearch').mockResolvedValue({
        responses: [{ hits: { hits: mockOpenSearchResults } }],
        strategyNames: ['semantic_service'],
        timings: {
          total_time: 50,
          request_build_time: 10,
          opensearch_call: {
            total_time: 40,
            client_breakdown: {
              http_round_trip_ms: 35,
              response_deserialize_ms: 5,
            },
            subqueries: {
              max_subquery_took: 30,
            },
            network_and_client_overhead_estimate: 10,
          },
        },
      });

      jest.spyOn(openSearchService, 'combineSearchResults').mockReturnValue({
        results: mockOpenSearchResults,
        totalResults: 2,
      });

      jest
        .spyOn(openSearchService, 'addDistanceInfo')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(openSearchService, 'addRelevantTextSnippets')
        .mockReturnValue(mockOpenSearchResults);

      // Mock reranking response (returns same order for simplicity)
      jest
        .spyOn(aiUtilsService, 'rerankResults')
        .mockResolvedValue(mockOpenSearchResults);

      const searchRequest = {
        q: 'food assistance',
        limit: 10,
        lang: 'en',
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.search(
        searchRequest,
        headers,
        tenant as any,
      );

      expect(result).toBeDefined();
      expect(result.hits.hits.length).toBe(2);
      expect(result.intent_classification).toEqual(mockClassification);
      expect(result.took).toBeGreaterThanOrEqual(0);

      // Verify the service was called with correct parameters
      expect(openSearchService.executeHybridSearch).toHaveBeenCalledWith(
        mockEmbedding,
        searchRequest,
        headers,
        tenant.name,
        mockClassification,
      );
      expect(openSearchService.combineSearchResults).toHaveBeenCalled();
      expect(aiUtilsService.rerankResults).toHaveBeenCalledWith(
        'food assistance',
        mockOpenSearchResults,
        10,
      );
    });

    it('should handle search without intent classification when disabled', async () => {
      // Mock embedding response only
      const mockEmbedding = new Array(1024).fill(0.1);
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: [{ embedding: mockEmbedding, index: 0 }],
          model: 'bge-m3:567m',
        },
      });

      const mockOpenSearchResults = [
        {
          _id: 'resource-1',
          _score: 0.95,
          _source: {
            id: 'resource-1',
            name: 'Test Resource',
          },
        },
      ];

      jest.spyOn(openSearchService, 'executeHybridSearch').mockResolvedValue({
        responses: [{ hits: { hits: mockOpenSearchResults } }],
        strategyNames: ['semantic_service'],
        timings: {
          total_time: 50,
          request_build_time: 10,
          opensearch_call: {
            total_time: 40,
            client_breakdown: {
              http_round_trip_ms: 35,
              response_deserialize_ms: 5,
            },
            subqueries: {
              max_subquery_took: 30,
            },
            network_and_client_overhead_estimate: 10,
          },
        },
      });

      jest.spyOn(openSearchService, 'combineSearchResults').mockReturnValue({
        results: mockOpenSearchResults,
        totalResults: 1,
      });

      jest
        .spyOn(openSearchService, 'addDistanceInfo')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(openSearchService, 'addRelevantTextSnippets')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(aiUtilsService, 'rerankResults')
        .mockResolvedValue(mockOpenSearchResults);

      const searchRequest = {
        q: 'test query',
        limit: 10,
        lang: 'en',
        disable_intent_classification: true,
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.search(
        searchRequest,
        headers,
        tenant as any,
      );

      expect(result).toBeDefined();
      expect(result.hits.hits.length).toBe(1);
      expect(result.intent_classification).toBeNull();
      // Should only call embedQuery, not classifyQuery
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it('should remove embeddings from results', async () => {
      const mockEmbedding = new Array(1024).fill(0.1);
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: [{ embedding: mockEmbedding, index: 0 }],
          model: 'bge-m3:567m',
        },
      });

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          primary_intent: 'test',
          confidence: 'high',
          is_low_information_query: false,
          combined_taxonomy_codes: [],
          top_intents: [],
          priority_rule_applied: false,
        },
      });

      const mockOpenSearchResults = [
        {
          _id: 'resource-1',
          _score: 0.95,
          _source: {
            id: 'resource-1',
            name: 'Test Resource',
            embedding: mockEmbedding, // This should be removed
            taxonomies: [
              {
                code: 'TEST',
                name: 'Test',
                embedding: mockEmbedding, // This should also be removed
              },
            ],
          },
        },
      ];

      jest.spyOn(openSearchService, 'executeHybridSearch').mockResolvedValue({
        responses: [{ hits: { hits: mockOpenSearchResults } }],
        strategyNames: ['semantic_service'],
        timings: {
          total_time: 50,
          request_build_time: 10,
          opensearch_call: {
            total_time: 40,
            client_breakdown: {
              http_round_trip_ms: 35,
              response_deserialize_ms: 5,
            },
            subqueries: {
              max_subquery_took: 30,
            },
            network_and_client_overhead_estimate: 10,
          },
        },
      });

      jest.spyOn(openSearchService, 'combineSearchResults').mockReturnValue({
        results: mockOpenSearchResults,
        totalResults: 1,
      });

      jest
        .spyOn(openSearchService, 'addDistanceInfo')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(openSearchService, 'addRelevantTextSnippets')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(aiUtilsService, 'rerankResults')
        .mockResolvedValue(mockOpenSearchResults);

      const searchRequest = {
        q: 'test',
        limit: 10,
        lang: 'en',
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.search(
        searchRequest,
        headers,
        tenant as any,
      );

      expect(result.hits.hits[0]._source.embedding).toBeUndefined();
      expect(
        result.hits.hits[0]._source.taxonomies[0].embedding,
      ).toBeUndefined();
    });

    it('should exclude service area when requested', async () => {
      const mockEmbedding = new Array(1024).fill(0.1);
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: [{ embedding: mockEmbedding, index: 0 }],
          model: 'bge-m3:567m',
        },
      });

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          primary_intent: 'test',
          confidence: 'high',
          is_low_information_query: false,
          combined_taxonomy_codes: [],
          top_intents: [],
          priority_rule_applied: false,
        },
      });

      const mockOpenSearchResults = [
        {
          _id: 'resource-1',
          _score: 0.95,
          _source: {
            id: 'resource-1',
            name: 'Test Resource',
            serviceArea: {
              type: 'Polygon',
              coordinates: [[]],
            },
          },
        },
      ];

      jest.spyOn(openSearchService, 'executeHybridSearch').mockResolvedValue({
        responses: [{ hits: { hits: mockOpenSearchResults } }],
        strategyNames: ['semantic_service'],
        timings: {
          total_time: 50,
          request_build_time: 10,
          opensearch_call: {
            total_time: 40,
            client_breakdown: {
              http_round_trip_ms: 35,
              response_deserialize_ms: 5,
            },
            subqueries: {
              max_subquery_took: 30,
            },
            network_and_client_overhead_estimate: 10,
          },
        },
      });

      jest.spyOn(openSearchService, 'combineSearchResults').mockReturnValue({
        results: mockOpenSearchResults,
        totalResults: 1,
      });

      jest
        .spyOn(openSearchService, 'addDistanceInfo')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(openSearchService, 'addRelevantTextSnippets')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(aiUtilsService, 'rerankResults')
        .mockResolvedValue(mockOpenSearchResults);

      const searchRequest = {
        q: 'test',
        limit: 10,
        lang: 'en',
        exclude_service_area: true,
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.search(
        searchRequest,
        headers,
        tenant as any,
      );

      expect(result.hits.hits[0]._source.serviceArea).toBeUndefined();
    });

    it('should handle browse mode with no query and no taxonomies', async () => {
      // In browse mode, no embedding or classification should be called
      const mockOpenSearchResults = [
        {
          _id: 'resource-1',
          _score: 1.0,
          _source: {
            id: 'resource-1',
            service: {
              name: 'Alpha Service',
            },
          },
          sort: ['Alpha Service', 'resource-1'],
        },
        {
          _id: 'resource-2',
          _score: 1.0,
          _source: {
            id: 'resource-2',
            service: {
              name: 'Beta Service',
            },
          },
          sort: ['Beta Service', 'resource-2'],
        },
      ];

      jest.spyOn(openSearchService, 'executeHybridSearch').mockResolvedValue({
        responses: [{ hits: { hits: mockOpenSearchResults } }],
        strategyNames: ['browse_match_all'],
        timings: {
          total_time: 50,
          request_build_time: 10,
          opensearch_call: {
            total_time: 40,
            client_breakdown: {
              http_round_trip_ms: 35,
              response_deserialize_ms: 5,
            },
            subqueries: {
              max_subquery_took: 30,
            },
            network_and_client_overhead_estimate: 10,
          },
        },
      });

      jest.spyOn(openSearchService, 'combineSearchResults').mockReturnValue({
        results: mockOpenSearchResults,
        totalResults: 2,
      });

      jest
        .spyOn(openSearchService, 'addDistanceInfo')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(openSearchService, 'addRelevantTextSnippets')
        .mockReturnValue(mockOpenSearchResults);

      const searchRequest = {
        limit: 10,
        lang: 'en',
        // No q, no taxonomies - browse mode
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.search(
        searchRequest as any,
        headers,
        tenant as any,
      );

      expect(result).toBeDefined();
      expect(result.hits.hits.length).toBe(2);
      // No embedding or classification should be called in browse mode
      expect(mockedAxios.post).not.toHaveBeenCalled();
      // Results should be in alphabetical order
      expect(result.hits.hits[0]._source.service.name).toBe('Alpha Service');
      expect(result.hits.hits[1]._source.service.name).toBe('Beta Service');
    });

    it('should handle browse mode with geographic filtering', async () => {
      const mockOpenSearchResults = [
        {
          _id: 'resource-1',
          _score: 1.0,
          _source: {
            id: 'resource-1',
            service: {
              name: 'Nearby Service',
            },
            location: {
              point: {
                lat: 47.6062,
                lon: -122.3321,
              },
            },
          },
          sort: ['Nearby Service', 'resource-1'],
        },
      ];

      jest.spyOn(openSearchService, 'executeHybridSearch').mockResolvedValue({
        responses: [{ hits: { hits: mockOpenSearchResults } }],
        strategyNames: ['browse_match_all'],
        timings: {
          total_time: 50,
          request_build_time: 10,
          opensearch_call: {
            total_time: 40,
            client_breakdown: {
              http_round_trip_ms: 35,
              response_deserialize_ms: 5,
            },
            subqueries: {
              max_subquery_took: 30,
            },
            network_and_client_overhead_estimate: 10,
          },
        },
      });

      jest.spyOn(openSearchService, 'combineSearchResults').mockReturnValue({
        results: mockOpenSearchResults,
        totalResults: 1,
      });

      jest
        .spyOn(openSearchService, 'addDistanceInfo')
        .mockReturnValue(mockOpenSearchResults);

      jest
        .spyOn(openSearchService, 'addRelevantTextSnippets')
        .mockReturnValue(mockOpenSearchResults);

      const searchRequest = {
        limit: 10,
        lang: 'en',
        lat: 47.6062,
        lon: -122.3321,
        distance: 50,
        // No q, no taxonomies - browse mode with geo filter
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.search(
        searchRequest as any,
        headers,
        tenant as any,
      );

      expect(result).toBeDefined();
      expect(result.hits.hits.length).toBe(1);
      // No embedding or classification should be called in browse mode
      expect(mockedAxios.post).not.toHaveBeenCalled();
      // Verify executeHybridSearch was called with geo parameters
      expect(openSearchService.executeHybridSearch).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          lat: 47.6062,
          lon: -122.3321,
          distance: 50,
        }),
        headers,
        tenant.name,
        null,
      );
    });
  });
});
