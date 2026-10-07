import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TaxonomyService } from './taxonomy.service';
import { MetricsService } from 'src/metrics/metrics.service';

describe('TaxonomyService', () => {
  let service: TaxonomyService;
  const search = jest.fn();

  beforeEach(async () => {
    search.mockReset().mockResolvedValue({
      hits: { total: { value: 0 }, hits: [] },
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxonomyService,
        { provide: ElasticsearchService, useValue: { search } },
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
        },
      ],
    }).compile();

    service = module.get<TaxonomyService>(TaxonomyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('search ordering', () => {
    const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' };
    const requestFor = async (
      query: { query?: string; code?: string; page: number },
      h: Record<string, string> = headers,
    ) => {
      search.mockClear();
      await service.searchTaxonomies({
        headers: h as never,
        query: query as never,
      });
      return search.mock.calls[0][0];
    };

    it('breaks score ties on code so a page is the same on every request', async () => {
      const request = await requestFor({ query: 'food', page: 1 });

      expect(request.sort).toEqual([
        { _score: { order: 'desc' } },
        { 'code.raw': { order: 'asc' } },
      ]);
    });

    it('keeps one preference for every page of a search', async () => {
      const preferences = [
        (await requestFor({ query: 'food', page: 1 })).preference,
        (await requestFor({ query: 'food', page: 3 })).preference,
      ];

      expect(preferences[0]).toEqual(expect.any(String));
      expect(preferences[0]).not.toMatch(/^_/);
      expect(new Set(preferences).size).toBe(1);
    });

    it('uses a different preference for a different search', async () => {
      const preferences = [
        (await requestFor({ query: 'food', page: 1 })).preference,
        (await requestFor({ query: 'rent', page: 1 })).preference,
        (await requestFor({ query: 'BD', page: 1 })).preference,
        (
          await requestFor(
            { query: 'food', page: 1 },
            { ...headers, 'accept-language': 'es' },
          )
        ).preference,
      ];

      expect(new Set(preferences).size).toBe(4);
    });
  });
});
