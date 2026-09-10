import { Test, TestingModule } from '@nestjs/testing';
import { SuggestionController } from './suggestion.controller';
import { SuggestionService } from './suggestion.service';

describe('SuggestionController', () => {
  let controller: SuggestionController;
  const getSuggestions = jest.fn();
  const getTaxonomyTermsForCodes = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SuggestionController],
      providers: [
        {
          provide: SuggestionService,
          useValue: { getSuggestions, getTaxonomyTermsForCodes },
        },
      ],
    }).compile();

    controller = module.get<SuggestionController>(SuggestionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates GET /suggestion to SuggestionService.getSuggestions', () => {
    const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' };
    const query = { query: 'hous', page: 1 } as any;
    getSuggestions.mockResolvedValue({ taxonomies: {}, organizations: [] });

    controller.getSuggestions(headers as any, query);

    expect(getSuggestions).toHaveBeenCalledWith({ headers, query });
  });

  it('delegates GET /suggestion/term to SuggestionService.getTaxonomyTermsForCodes', () => {
    const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' };
    const query = { terms: ['FT-2700'] };
    getTaxonomyTermsForCodes.mockResolvedValue({ hits: { hits: [] } });

    controller.getTaxonomyTermsByCode(headers as any, query);

    expect(getTaxonomyTermsForCodes).toHaveBeenCalledWith({ headers, query });
  });
});
