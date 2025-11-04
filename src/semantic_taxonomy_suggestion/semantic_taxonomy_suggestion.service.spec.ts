import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SemanticTaxonomySuggestionService } from './semantic_taxonomy_suggestion.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';

// Mock the OpenSearch client
jest.mock('@opensearch-project/opensearch', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({
      msearch: jest.fn(),
      cluster: {
        health: jest.fn(),
      },
    })),
  };
});

describe('SemanticTaxonomySuggestionService', () => {
  let service: SemanticTaxonomySuggestionService;
  let aiUtilsService: AiUtilsService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        OPENSEARCH_NODE: 'http://localhost:9200',
        AI_UTILS_URL: 'http://localhost:8001',
        OLLAMA_BASE_URL: 'http://localhost:11434',
        OLLAMA_EMBEDDING_MODEL: 'bge-m3:567m',
      };
      return config[key];
    }),
  };

  const mockAiUtilsService = {
    embedQuery: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemanticTaxonomySuggestionService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AiUtilsService,
          useValue: mockAiUtilsService,
        },
      ],
    }).compile();

    service = module.get<SemanticTaxonomySuggestionService>(
      SemanticTaxonomySuggestionService,
    );
    aiUtilsService = module.get<AiUtilsService>(AiUtilsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getTaxonomySuggestions', () => {
    it('should embed query and return suggestions', async () => {
      const mockEmbedding = new Array(1024).fill(0.1);
      mockAiUtilsService.embedQuery.mockResolvedValue(mockEmbedding);

      // Mock the OpenSearch client msearch response
      const mockMsearchResponse = {
        body: {
          responses: [
            {
              hits: {
                hits: [
                  {
                    _id: 'resource-1',
                    _score: 0.95,
                    _source: {
                      taxonomies: [
                        {
                          code: 'BD-1800',
                          name: 'Food Pantries',
                          description: 'Programs that provide food',
                        },
                      ],
                    },
                    inner_hits: {
                      matched_taxonomies: {
                        hits: {
                          hits: [
                            {
                              _source: {
                                code: 'BD-1800',
                                name: 'Food Pantries',
                                description: 'Programs that provide food',
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
            {
              hits: {
                hits: [
                  {
                    _id: 'resource-2',
                    _score: 0.88,
                    _source: {
                      taxonomies: [
                        {
                          code: 'BD-1800.1500',
                          name: 'Emergency Food',
                        },
                      ],
                    },
                    inner_hits: {
                      matched_taxonomies: {
                        hits: {
                          hits: [
                            {
                              _source: {
                                code: 'BD-1800.1500',
                                name: 'Emergency Food',
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      };

      // Access the mocked client through the service's private property
      (service as any).client.msearch.mockResolvedValue(mockMsearchResponse);

      const query = {
        query: 'food assistance',
        limit: 10,
        lang: 'en',
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.getTaxonomySuggestions(
        query,
        headers,
        tenant as any,
      );

      expect(aiUtilsService.embedQuery).toHaveBeenCalledWith('food assistance');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.metadata.embedding_used).toBe(true);
      expect(result.metadata.search_strategy).toBe('hybrid_semantic_text');
    });

    it('should aggregate taxonomies across multiple resources', async () => {
      const mockEmbedding = new Array(1024).fill(0.1);
      mockAiUtilsService.embedQuery.mockResolvedValue(mockEmbedding);

      // Mock response with same taxonomy appearing in multiple resources
      const mockMsearchResponse = {
        body: {
          responses: [
            {
              hits: {
                hits: [
                  {
                    _id: 'resource-1',
                    _score: 0.95,
                    inner_hits: {
                      matched_taxonomies: {
                        hits: {
                          hits: [
                            {
                              _source: {
                                code: 'BD-1800',
                                name: 'Food Pantries',
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                  {
                    _id: 'resource-2',
                    _score: 0.92,
                    inner_hits: {
                      matched_taxonomies: {
                        hits: {
                          hits: [
                            {
                              _source: {
                                code: 'BD-1800',
                                name: 'Food Pantries',
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
            {
              hits: { hits: [] },
            },
          ],
        },
      };

      (service as any).client.msearch.mockResolvedValue(mockMsearchResponse);

      const query = {
        query: 'food',
        limit: 10,
        lang: 'en',
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await service.getTaxonomySuggestions(
        query,
        headers,
        tenant as any,
      );

      // Should have only one unique taxonomy with resource_count = 2
      const foodPantryTaxonomy = result.suggestions.find(
        (s) => s.code === 'BD-1800',
      );
      expect(foodPantryTaxonomy).toBeDefined();
      expect(foodPantryTaxonomy?.resource_count).toBe(2);
    });
  });

  describe('checkHealth', () => {
    it('should return connected status when cluster is healthy', async () => {
      const mockHealthResponse = {
        body: { status: 'green', number_of_nodes: 1 },
      };

      (service as any).client.cluster.health.mockResolvedValue(
        mockHealthResponse,
      );

      const result = await service.checkHealth();

      expect(result.status).toBe('connected');
      expect(result.cluster).toEqual(mockHealthResponse.body);
    });

    it('should return disconnected status on error', async () => {
      (service as any).client.cluster.health.mockRejectedValue(
        new Error('Connection failed'),
      );

      const result = await service.checkHealth();

      expect(result.status).toBe('disconnected');
      expect(result.error).toBe('Connection failed');
    });
  });
});
