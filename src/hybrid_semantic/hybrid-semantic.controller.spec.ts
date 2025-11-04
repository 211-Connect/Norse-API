import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { HybridSemanticController } from './hybrid-semantic.controller';
import { HybridSemanticService } from './hybrid-semantic.service';
import { AiUtilsService } from 'src/common/services/ai-utils.service';
import { OpenSearchService } from './services/opensearch.service';

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

describe('HybridSemanticController', () => {
  let controller: HybridSemanticController;
  let service: HybridSemanticService;

  beforeEach(async () => {
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
      controllers: [HybridSemanticController],
      providers: [HybridSemanticService, AiUtilsService, OpenSearchService],
    }).compile();

    controller = module.get<HybridSemanticController>(HybridSemanticController);
    service = module.get<HybridSemanticService>(HybridSemanticService);
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
    expect(controller).toBeDefined();
  });

  describe('search', () => {
    it('should call service.search with correct parameters', async () => {
      const mockResponse = {
        took: 150,
        timed_out: false,
        hits: {
          total: {
            value: 1,
            relation: 'eq',
          },
          max_score: 0.95,
          hits: [
            {
              _id: 'resource-1',
              _score: 0.95,
              _source: {
                id: 'resource-1',
                name: 'Test Resource',
              },
            },
          ],
        },
        metadata: {
          search_pipeline: 'hybrid_semantic',
          intent_classification: null,
          is_low_information_query: false,
          phase_timings: {},
        },
      };

      jest.spyOn(service, 'search').mockResolvedValue(mockResponse);

      const searchRequest = {
        q: 'test query',
        limit: 10,
        lang: 'en',
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await controller.search(
        headers,
        searchRequest,
        tenant as any,
      );

      expect(result).toEqual(mockResponse);
      expect(service.search).toHaveBeenCalledWith(
        searchRequest,
        headers,
        tenant,
      );
    });

    it('should handle geospatial search parameters', async () => {
      const mockResponse = {
        took: 150,
        timed_out: false,
        hits: {
          total: {
            value: 0,
            relation: 'eq',
          },
          max_score: null,
          hits: [],
        },
        metadata: {
          search_pipeline: 'hybrid_semantic',
          intent_classification: null,
          is_low_information_query: false,
          phase_timings: {},
        },
      };

      jest.spyOn(service, 'search').mockResolvedValue(mockResponse);

      const searchRequest = {
        q: 'food assistance near me',
        limit: 20,
        lang: 'en',
        lat: 47.6062,
        lon: -122.3321,
        distance: 50,
      };

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const tenant = { name: 'Illinois 211' };

      const result = await controller.search(
        headers,
        searchRequest,
        tenant as any,
      );

      expect(result).toEqual(mockResponse);
      expect(service.search).toHaveBeenCalledWith(
        searchRequest,
        headers,
        tenant,
      );
    });
  });
});
