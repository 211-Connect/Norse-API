import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { OrchestrationConfigService } from '../cms-config/orchestration-config.service';
import { HybridSearchService } from './hybrid-search.service';
import { MetricsService } from 'src/metrics/metrics.service';
import { AiSearchService } from './ai-search.service';

describe('SearchController', () => {
  let controller: SearchController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
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
          provide: MetricsService,
          useValue: {
            incrementSearchHit: jest.fn(),
          },
        },
        {
          provide: AiSearchService,
          useValue: {
            predict: jest.fn(),
            reRank: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
