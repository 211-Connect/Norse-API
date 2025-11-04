import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { HybridSemanticService } from './hybrid-semantic.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { OpenSearchService } from './services/opensearch.service';
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
      providers: [HybridSemanticService, AiUtilsService, OpenSearchService],
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

      jest
        .spyOn(openSearchService, 'executeHybridSearch')
        .mockResolvedValue(mockOpenSearchResults);

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
      expect(result.metadata.search_pipeline).toBe('hybrid_semantic');
      expect(result.metadata.intent_classification).toEqual(mockClassification);
      expect(result.took).toBeGreaterThanOrEqual(0);

      // Verify the service was called with correct parameters
      expect(openSearchService.executeHybridSearch).toHaveBeenCalledWith(
        mockEmbedding,
        searchRequest,
        headers,
        tenant.name,
        mockClassification,
      );
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

      jest
        .spyOn(openSearchService, 'executeHybridSearch')
        .mockResolvedValue(mockOpenSearchResults);

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
      expect(result.metadata.intent_classification).toBeNull();
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

      jest
        .spyOn(openSearchService, 'executeHybridSearch')
        .mockResolvedValue(mockOpenSearchResults);

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

      jest
        .spyOn(openSearchService, 'executeHybridSearch')
        .mockResolvedValue(mockOpenSearchResults);

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
  });
});
