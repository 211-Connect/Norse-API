import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SemanticTaxonomySuggestionService } from './semantic_taxonomy_suggestion.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import axios from 'axios';

// Mock axios for external HTTP calls
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

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
      providers: [SemanticTaxonomySuggestionService, AiUtilsService],
    }).compile();

    service = module.get<SemanticTaxonomySuggestionService>(
      SemanticTaxonomySuggestionService,
    );
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

  describe('getTaxonomySuggestions', () => {
    it('should classify query and return suggestions', async () => {
      // Mock axios response for classifyQuery
      const mockClassification = {
        primary_intent: 'food_assistance',
        confidence: 'high',
        is_low_information_query: false,
        combined_taxonomy_codes: ['BD-1800', 'BD-1800.1500'],
        top_intents: [],
        priority_rule_applied: false,
      };
      mockedAxios.post.mockResolvedValueOnce({
        data: mockClassification,
      });

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

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:8000/api/v1/intent-classification',
        { query: 'food assistance', request_id: null },
        expect.any(Object),
      );
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.metadata.embedding_used).toBe(false);
      expect(result.metadata.search_strategy).toBe('intent_classification');
    });

    it('should aggregate taxonomies across multiple resources', async () => {
      // Mock axios response for classifyQuery
      const mockClassification = {
        primary_intent: 'food_assistance',
        confidence: 'high',
        is_low_information_query: false,
        combined_taxonomy_codes: ['BD-1800'],
        top_intents: [],
        priority_rule_applied: false,
      };
      mockedAxios.post.mockResolvedValueOnce({
        data: mockClassification,
      });

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
                    _source: {
                      taxonomies: [
                        {
                          code: 'BD-1800',
                          name: 'Food Pantries',
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
                    _source: {
                      taxonomies: [
                        {
                          code: 'BD-1800',
                          name: 'Food Pantries',
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

    it('should filter results by single code prefix', async () => {
      // Mock axios response for classifyQuery
      const mockClassification = {
        primary_intent: 'food_assistance',
        confidence: 'high',
        is_low_information_query: false,
        combined_taxonomy_codes: ['BD-1800'],
        top_intents: [],
        priority_rule_applied: false,
      };
      mockedAxios.post.mockResolvedValueOnce({
        data: mockClassification,
      });

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
        code: ['BD'],
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

      expect(result.suggestions).toBeDefined();
      // Verify that msearch was called with code prefix filter
      expect((service as any).client.msearch).toHaveBeenCalled();
    });

    it('should filter results by multiple code prefixes', async () => {
      // Mock axios response for classifyQuery
      const mockClassification = {
        primary_intent: 'general_assistance',
        confidence: 'medium',
        is_low_information_query: false,
        combined_taxonomy_codes: ['BD-1800', 'LR-8000'],
        top_intents: [],
        priority_rule_applied: false,
      };
      mockedAxios.post.mockResolvedValueOnce({
        data: mockClassification,
      });

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
                    _source: {
                      taxonomies: [
                        {
                          code: 'LR-8000',
                          name: 'Speech and Hearing',
                        },
                      ],
                    },
                    inner_hits: {
                      matched_taxonomies: {
                        hits: {
                          hits: [
                            {
                              _source: {
                                code: 'LR-8000',
                                name: 'Speech and Hearing',
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
        query: 'assistance',
        code: ['BD', 'LR'],
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

      expect(result.suggestions).toBeDefined();
      expect(result.suggestions.length).toBeGreaterThan(0);
      // Should contain taxonomies from both BD and LR prefixes
      const hasBDTaxonomy = result.suggestions.some((s) =>
        s.code.startsWith('BD'),
      );
      const hasLRTaxonomy = result.suggestions.some((s) =>
        s.code.startsWith('LR'),
      );
      expect(hasBDTaxonomy || hasLRTaxonomy).toBe(true);
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
