import { Test, TestingModule } from '@nestjs/testing';
import { SemanticTaxonomySuggestionController } from './semantic_taxonomy_suggestion.controller';
import { SemanticTaxonomySuggestionService } from './semantic_taxonomy_suggestion.service';
import { TaxonomySuggestionResponse } from './dto/taxonomy-suggestion-response.dto';

describe('SemanticTaxonomySuggestionController', () => {
  let controller: SemanticTaxonomySuggestionController;
  let service: SemanticTaxonomySuggestionService;

  const mockTaxonomySuggestionService = {
    getTaxonomySuggestions: jest.fn(),
    checkHealth: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SemanticTaxonomySuggestionController],
      providers: [
        {
          provide: SemanticTaxonomySuggestionService,
          useValue: mockTaxonomySuggestionService,
        },
      ],
    }).compile();

    controller = module.get<SemanticTaxonomySuggestionController>(
      SemanticTaxonomySuggestionController,
    );
    service = module.get<SemanticTaxonomySuggestionService>(
      SemanticTaxonomySuggestionService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getTaxonomySuggestions', () => {
    it('should return taxonomy suggestions', async () => {
      const mockResponse: TaxonomySuggestionResponse = {
        took: 50,
        suggestions: [
          {
            code: 'BD-1800',
            name: 'Food Pantries',
            description: 'Programs that provide food',
            score: 0.95,
            match_type: 'hybrid',
            resource_count: 25,
          },
          {
            code: 'BD-1800.1500',
            name: 'Emergency Food',
            score: 0.88,
            match_type: 'text',
            resource_count: 15,
          },
        ],
        metadata: {
          query: 'food assistance',
          total_unique_taxonomies: 2,
          search_strategy: 'hybrid_semantic_text',
          embedding_used: true,
        },
      };

      mockTaxonomySuggestionService.getTaxonomySuggestions.mockResolvedValue(
        mockResponse,
      );

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const query = {
        query: 'food assistance',
        limit: 10,
        lang: 'en',
      };

      const tenant = { name: 'Test Tenant' };

      const result = await controller.getTaxonomySuggestions(
        headers,
        query,
        tenant as any,
      );

      expect(result).toEqual(mockResponse);
      expect(service.getTaxonomySuggestions).toHaveBeenCalledWith(
        query,
        headers,
        tenant,
      );
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].code).toBe('BD-1800');
    });

    it('should handle code prefix filtering', async () => {
      const mockResponse: TaxonomySuggestionResponse = {
        took: 30,
        suggestions: [
          {
            code: 'BD-1800',
            name: 'Food Pantries',
            score: 0.95,
            match_type: 'hybrid',
            resource_count: 25,
          },
        ],
        metadata: {
          query: 'food',
          total_unique_taxonomies: 1,
          search_strategy: 'hybrid_semantic_text',
          embedding_used: true,
        },
      };

      mockTaxonomySuggestionService.getTaxonomySuggestions.mockResolvedValue(
        mockResponse,
      );

      const headers = {
        'x-tenant-id': 'test-tenant',
        'accept-language': 'en',
      };

      const query = {
        query: 'food',
        code: 'BD',
        limit: 10,
        lang: 'en',
      };

      const tenant = { name: 'Test Tenant' };

      const result = await controller.getTaxonomySuggestions(
        headers,
        query,
        tenant as any,
      );

      expect(result).toEqual(mockResponse);
      expect(result.suggestions[0].code).toMatch(/^BD/);
    });
  });

  describe('checkHealth', () => {
    it('should return health status', async () => {
      const mockHealth = {
        status: 'connected',
        cluster: { status: 'green' },
      };

      mockTaxonomySuggestionService.checkHealth.mockResolvedValue(mockHealth);

      const result = await controller.checkHealth();

      expect(result).toEqual(mockHealth);
      expect(service.checkHealth).toHaveBeenCalled();
    });
  });
});
