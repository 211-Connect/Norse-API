// `@arcjet/nest` ships ESM only; the guard decorator only needs the token.
jest.mock('@arcjet/nest', () => ({ ARCJET: 'ARCJET' }));

import { Test, TestingModule } from '@nestjs/testing';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { createUsageMetricsServiceMock } from 'src/metrics/testing/usage-metrics-service.mock';
import { UsageMetricsService } from 'src/metrics/usage-metrics.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { OrchestrationConfigService } from '../cms-config/orchestration-config.service';
import { HybridSearchService } from './hybrid-search.service';
import { AiSearchService } from './ai-search.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { Request } from 'express';
import { MetricsService } from 'src/metrics/metrics.service';

describe('SearchController', () => {
  let controller: SearchController;
  let module: TestingModule;
  let usageMetrics: { recordSearchRequest: jest.Mock };

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        SearchService,
        {
          provide: ElasticsearchService,
          useValue: {
            search: jest.fn(),
          },
        },
        {
          provide: TenantConfigService,
          useValue: {
            getFacets: jest.fn().mockResolvedValue([]),
            getSearchConfig: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: OrchestrationConfigService,
          useValue: {
            getCustomAttributesByTenantId: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: HybridSearchService,
          useValue: {
            searchHybrid: jest.fn(),
          },
        },
        {
          provide: AiSearchService,
          useValue: {
            predict: jest.fn(),
            reRank: jest.fn(),
          },
        },
        {
          provide: RequestCacheService,
          useValue: {
            getOrSet: jest.fn((_key, factory) => factory()),
          },
        },
        {
          provide: MetricsService,
          useValue: createMetricsServiceMock(),
        },
        {
          provide: UsageMetricsService,
          useValue: createUsageMetricsServiceMock(),
        },
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
    usageMetrics = module.get(
      UsageMetricsService,
    ) as unknown as typeof usageMetrics;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  const headers = { 'x-tenant-id': 'tenant-1', 'accept-language': 'es' };
  const req = {
    tenantId: 'tenant-1',
    headers: { 'accept-language': 'es-MX' },
  } as unknown as Request;

  it('records one search request when the search returns hits', async () => {
    jest.spyOn(module.get(SearchService), 'searchResources').mockResolvedValue({
      search: { hits: { total: { value: 2 }, hits: [] } },
    } as never);

    await controller.getResources(
      headers,
      { query: 'housing', query_type: 'text' } as never,
      req,
    );

    expect(usageMetrics.recordSearchRequest).toHaveBeenCalledTimes(1);
    expect(usageMetrics.recordSearchRequest).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', acceptLanguage: 'es-MX' },
      'keyword',
      'results',
    );
  });

  it('records an error outcome when the search rejects', async () => {
    jest
      .spyOn(module.get(SearchService), 'searchResources')
      .mockRejectedValue(new Error('boom'));

    await expect(
      controller.getResources(
        headers,
        { query: '', query_type: 'text' } as never,
        req,
      ),
    ).rejects.toThrow('boom');

    expect(usageMetrics.recordSearchRequest).toHaveBeenCalledTimes(1);
    expect(usageMetrics.recordSearchRequest).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', acceptLanguage: 'es-MX' },
      'match_all',
      'error',
    );
  });
});
