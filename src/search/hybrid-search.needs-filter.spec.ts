import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import {
  HybridSearchService,
  V2_NEEDS_FILTER_APPLIES_TO_PINS,
} from './hybrid-search.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';

const headers = { 'x-tenant-id': 'tenant-a', 'accept-language': 'en' } as any;

const mainResponse = {
  took: 5,
  timed_out: false,
  _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
  hits: {
    total: { value: 7, relation: 'eq' },
    hits: [],
  },
  aggregations: {},
};

describe('HybridSearchService - needs filter and counts (ISS-2499)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let countMode: 'ok' | 'throw';

  beforeEach(async () => {
    requests = [];
    countMode = 'ok';
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve({ hits: { hits: [] } });
      }
      requests.push(req);
      if (req.aggs?.need_counts) {
        if (countMode === 'throw') return Promise.reject(new Error('es down'));
        return Promise.resolve({
          ...mainResponse,
          aggregations: {
            need_counts: {
              buckets: [
                { key: 'N-FOD-01', doc_count: 4 },
                { key: 'N-FOD', doc_count: 6 },
              ],
            },
          },
        });
      }
      return Promise.resolve(mainResponse);
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridSearchService,
        {
          provide: ElasticsearchService,
          useValue: { search: esSearch, count: jest.fn() },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
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
    service = module.get(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  });

  const baseQuery = {
    query: 'food',
    page: 1,
    limit: 25,
    filters: {},
    distance: 0,
    taxonomy: [] as string[],
  } as any;

  const run = (extra: Record<string, unknown> = {}) =>
    service.searchHybrid({ headers, query: baseQuery, ...extra } as any);
  const mainRequest = () => requests.find((r) => !r.aggs?.need_counts);
  const countRequest = () => requests.find((r) => r.aggs?.need_counts);
  const filtersOf = (req: any) =>
    (req.query.function_score ? req.query.function_score.query : req.query).bool
      .filter;
  const needsClause = (req: any) =>
    JSON.stringify(filtersOf(req)).includes('sune_needs');

  it('adds a terms filter on sune_needs for the sent needs', async () => {
    await run({ needsFilter: ['N-FOD-01', 'N-HOU'] });
    expect(filtersOf(mainRequest())).toContainEqual(
      V2_NEEDS_FILTER_APPLIES_TO_PINS
        ? { terms: { sune_needs: ['N-FOD-01', 'N-HOU'] } }
        : expect.anything(),
    );
  });

  it('a Tier 1 code filters on its own tag alone (no expansion)', async () => {
    await run({ needsFilter: ['N-FOD'] });
    expect(JSON.stringify(filtersOf(mainRequest()))).toContain('["N-FOD"]');
  });

  it('adds no filter without needsFilter or with an empty list', async () => {
    await run();
    expect(needsClause(mainRequest())).toBe(false);
    requests = [];
    await run({ needsFilter: [] });
    expect(needsClause(mainRequest())).toBe(false);
  });

  it('the request is identical to v1 when no v2 option is set', async () => {
    await run();
    const a = mainRequest();
    requests = [];
    await run({ needsFilter: [], countCodes: [] });
    expect(mainRequest()).toEqual(a);
    expect(requests).toHaveLength(1);
  });

  it('counts: terms aggregation limited to the codes, same filters, no needs filter', async () => {
    const res: any = await run({
      needsFilter: ['N-HOU'],
      countCodes: ['N-FOD', 'N-FOD-01', 'N-HOU'],
    });
    const c = countRequest();
    expect(c.size).toBe(0);
    expect(c.aggs.need_counts.terms.field).toBe('sune_needs');
    expect(c.aggs.need_counts.terms.include).toEqual([
      'N-FOD',
      'N-FOD-01',
      'N-HOU',
    ]);
    expect(needsClause(c)).toBe(false);
    expect(needsClause(mainRequest())).toBe(true);
    // the same tenant filter as the results
    expect(JSON.stringify(filtersOf(c))).toContain('tenant-a');
    expect(res.needCounts['N-FOD-01']).toBe(4);
  });

  it('counts: writes 0 for every requested code the aggregation omits', async () => {
    const res: any = await run({ countCodes: ['N-FOD', 'N-FOD-01', 'N-HOU'] });
    expect(res.needCounts).toEqual({ 'N-FOD': 6, 'N-FOD-01': 4, 'N-HOU': 0 });
  });

  it('counts: not requested means no count request and no needCounts', async () => {
    const res: any = await run();
    expect(countRequest()).toBeUndefined();
    expect('needCounts' in res).toBe(false);
  });

  it('counts: a failed count request leaves needCounts out (not counted)', async () => {
    countMode = 'throw';
    const res: any = await run({ countCodes: ['N-FOD'] });
    expect('needCounts' in res).toBe(false);
    expect(res.search.hits.total.value).toBe(7);
  });
});
