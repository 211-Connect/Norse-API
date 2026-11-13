import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import {
  HybridSearchService,
  buildNeedBlockSort,
  buildMatchedNeedsField,
  NEED_BLOCK_SCRIPT,
  MATCHED_NEEDS_SCRIPT,
} from './hybrid-search.service';
import { SearchUtilsService } from './search-utils.service';
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

describe('HybridSearchService - need blocks and counts (ISS-2499)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let countMode: 'ok' | 'throw';
  let searchConfig: Record<string, unknown>;
  let mainHits: any[];

  beforeEach(async () => {
    requests = [];
    countMode = 'ok';
    searchConfig = {};
    mainHits = [];
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
      return Promise.resolve({
        ...mainResponse,
        hits: { ...mainResponse.hits, hits: mainHits },
      });
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
            getSearchConfig: jest
              .fn()
              .mockImplementation(async () => searchConfig),
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

  it('selectedNeeds never filter: no clause mentions sune_needs', async () => {
    await run({ selectedNeeds: ['N-FOD-01', 'N-HOU'] });
    expect(JSON.stringify(mainRequest().query)).not.toContain('sune_needs');
  });

  it('sort[0] is the need block sort', async () => {
    await run({ selectedNeeds: ['A', 'B'] });
    const first = mainRequest().sort[0];
    expect(first).toEqual(buildNeedBlockSort(['A', 'B']));
    expect(first._script.type).toBe('number');
    expect(first._script.order).toBe('desc');
    expect(first._script.script.params.codes).toEqual(['A', 'B']);
  });

  it('removes duplicate codes', async () => {
    await run({ selectedNeeds: ['A', 'A', 'B'] });
    expect(mainRequest().sort[0]._script.script.params.codes).toEqual([
      'A',
      'B',
    ]);
  });

  it('blocks lead the pinned and priority tiers in top mode', async () => {
    searchConfig = { pinned_resources_mode: 'top' };
    await run({ selectedNeeds: ['A', 'B'] });
    const sort = mainRequest().sort;
    expect(sort[0]).toEqual(buildNeedBlockSort(['A', 'B']));
    expect(sort[1]).toEqual({ pinned: 'desc' });
    expect(sort[2]).toEqual({ priority: 'desc' });
  });

  it('blocks lead the geo distance sort', async () => {
    const coords = [-76.6122, 39.2904];
    await run({
      query: { ...baseQuery, sort: 'distance', coords },
      selectedNeeds: ['A'],
    });
    const sort = mainRequest().sort;
    expect(sort[0]).toEqual(buildNeedBlockSort(['A']));
    expect(sort[1]).toEqual(SearchUtilsService.getGeoDistanceSort(coords));
  });

  it('no selectedNeeds or an empty list: query and sort equal the no-option request', async () => {
    searchConfig = { pinned_resources_mode: 'top' };
    await run();
    const a = mainRequest();
    requests = [];
    await run({ selectedNeeds: [] });
    expect(mainRequest().query).toEqual(a.query);
    expect(mainRequest().sort).toEqual(a.sort);
    expect(JSON.stringify(a.sort)).not.toContain('_script');
  });

  it('the count request has no script sort and no needs clause', async () => {
    await run({ selectedNeeds: ['A'], countCodes: ['A'] });
    const c = countRequest();
    expect(c.sort).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain('_script');
    expect(needsClause(c)).toBe(false);
  });

  it('the request is identical to v1 when no v2 option is set', async () => {
    await run();
    const a = mainRequest();
    requests = [];
    await run({ selectedNeeds: [], countCodes: [] });
    expect(mainRequest()).toEqual(a);
    expect(requests).toHaveLength(1);
  });

  it('counts: terms aggregation limited to the codes, same filters, no needs clause', async () => {
    const res: any = await run({
      selectedNeeds: ['N-HOU'],
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

  describe('matched_needs per hit', () => {
    const hit = (id: string, fields?: any, sort?: number[]) => ({
      _index: 'i',
      _id: id,
      _score: 1,
      _source: { name: id, sune_needs: ['SECRET'] },
      ...(fields ? { fields } : {}),
      ...(sort ? { sort } : {}),
    });

    it('requests a script field built from the same match rule as the sort', async () => {
      await run({ selectedNeeds: ['A', 'B'] });
      const sf = mainRequest().script_fields.matched_needs;
      expect(sf).toEqual(buildMatchedNeedsField(['A', 'B']));
      expect(sf.script.params.codes).toEqual(['A', 'B']);
      // one rule, one place: both scripts start with the same match fragment
      const matchPart = NEED_BLOCK_SCRIPT.split(' return ')[0];
      expect(MATCHED_NEEDS_SCRIPT.startsWith(matchPart)).toBe(true);
      expect(mainRequest()._source).toEqual({
        excludes: ['embedding', 'service_area'],
      });
    });

    it('no script field when no needs are sent', async () => {
      await run();
      expect(mainRequest().script_fields).toBeUndefined();
      await run({ selectedNeeds: [] });
      expect(mainRequest().script_fields).toBeUndefined();
    });

    it('hits carry matched_needs: both, one, none, in sent order', async () => {
      mainHits = [
        hit('a', { matched_needs: ['A', 'B'] }, [2, 5]),
        hit('b', { matched_needs: ['B'] }, [1, 4]),
        hit('c', { matched_needs: [] }, [0, 3]),
        hit('d', undefined, [0, 2]),
      ];
      const res: any = await run({ selectedNeeds: ['A', 'B'] });
      const hs = res.search.hits.hits;
      expect(hs.map((h: any) => h.matched_needs)).toEqual([
        ['A', 'B'],
        ['B'],
        [],
        [],
      ]);
    });

    it('does not return the block number or tag fields', async () => {
      mainHits = [hit('a', { matched_needs: ['A'] }, [2, 5])];
      const res: any = await run({ selectedNeeds: ['A'] });
      const h = res.search.hits.hits[0];
      expect(h.sort).toEqual([5]);
      expect(h.fields).toBeUndefined();
      expect('needs_block' in h).toBe(false);
    });

    it('matched_needs is absent when no needs were sent (v1 shape)', async () => {
      mainHits = [hit('a', undefined, [5])];
      const res: any = await run();
      const h = res.search.hits.hits[0];
      expect('matched_needs' in h).toBe(false);
      expect(h.sort).toEqual([5]);
    });
  });
});
