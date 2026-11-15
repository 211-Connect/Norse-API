import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';

const headers = {
  'x-tenant-id': 'tenant-a',
  'accept-language': 'en',
} as any;

const taxonomyResponse = {
  hits: {
    hits: [
      {
        _id: 't1',
        _score: 0.8,
        _source: { code: 'YS-5000.5000', name: 'Men' },
      },
      {
        _id: 't2',
        _score: 0.75,
        _source: {
          code: 'BH-1800.8500 * YS-5000.5000',
          name: 'Homeless Shelter * Men',
        },
      },
      {
        _id: 't3',
        _score: 0.7,
        _source: {
          code: 'BH-1800.1500-100',
          name: 'Domestic Violence Shelters',
        },
      },
    ],
  },
};

const mainResponse = {
  took: 5,
  timed_out: false,
  _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
  hits: { total: { value: 1, relation: 'eq' }, hits: [] },
  aggregations: {},
};

describe('HybridSearchService - population weight (ISS-2693)', () => {
  let service: HybridSearchService;
  let requests: any[];

  beforeEach(async () => {
    requests = [];
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve(taxonomyResponse);
      }
      requests.push(req);
      return Promise.resolve(mainResponse);
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearch, count: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'EMBEDDING_BASE_URL') return 'https://embed.example';
              if (key === 'EMBEDDING_MODEL') return 'model-x';
              if (key === 'RUNPOD_API_KEY') return 'key';
              return undefined;
            }),
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
          provide: RequestCacheService,
          useValue: { getOrSet: jest.fn((_k: any, f: any) => f()) },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
      ],
    }).compile();
    service = module.get<HybridSearchService>(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  });

  const run = (query: string, rankingVersion?: 'v2') =>
    service.searchHybrid({
      headers,
      query: {
        query,
        page: 1,
        limit: 25,
        filters: {},
        distance: 0,
        taxonomy: [] as string[],
      } as any,
      ...(rankingVersion ? { rankingVersion } : {}),
    } as any);

  const mainRequest = () =>
    requests.find((r) => r.aggs !== undefined && r.query?.function_score);
  const shouldOf = (req: any) => {
    const q = req.query;
    return (q.function_score ? q.function_score.query : q).bool.should;
  };
  // code -> boost for every taxonomy boost clause in the main request
  const taxonomyBoosts = (req: any) => {
    const out: Record<string, number> = {};
    for (const c of shouldOf(req)) {
      const cs = c.nested?.query?.constant_score;
      const t = cs?.filter?.term?.['taxonomies.code'];
      if (t) out[t] = cs.boost;
    }
    return out;
  };

  const MEN = 'YS-5000.5000';
  const HOMELESS_MEN = 'BH-1800.8500 * YS-5000.5000';
  const DV = 'BH-1800.1500-100';

  it('v2 "my boyfriend hits me": no boost for Men codes, DV kept at its position', async () => {
    await run('my boyfriend hits me');
    const v1 = taxonomyBoosts(mainRequest());
    requests = [];
    await run('my boyfriend hits me', 'v2');
    const v2 = taxonomyBoosts(mainRequest());

    expect(Object.keys(v2)).toEqual([DV]);
    expect(v2[DV]).toBeCloseTo(v1[DV]); // position index 2 kept
  });

  it('v1: all three clauses stay', async () => {
    await run('my boyfriend hits me');
    const boosts = taxonomyBoosts(mainRequest());
    expect(Object.keys(boosts).sort()).toEqual([DV, HOMELESS_MEN, MEN].sort());
  });

  it('v2 "shelter for men": the Men clause is present', async () => {
    await run('shelter for men', 'v2');
    const boosts = taxonomyBoosts(mainRequest());
    expect(boosts).toHaveProperty([MEN]);
    expect(boosts).toHaveProperty([DV]);
  });
});
