import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { HybridSearchService } from './hybrid-search.service';
import { SearchUtilsService } from './search-utils.service';
import { TenantConfigService } from '../cms-config/tenant-config.service';
import { RequestCacheService } from 'src/common/services/cache/request-cache.service';
import { createMetricsServiceMock } from 'src/metrics/testing/metrics-service.mock';
import { MetricsService } from 'src/metrics/metrics.service';
import { wordRarityCacheKey } from './internal/cache-key/word-rarity-cache-key';

const headers = {
  'x-tenant-id': 'tenant-a',
  'accept-language': 'en',
} as any;

const hitsOf = (ids: string[]) => ({
  hits: { hits: ids.map((id) => ({ _id: id })) },
});

const mainResponse = {
  took: 5,
  timed_out: false,
  _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
  hits: {
    total: { value: 1, relation: 'eq' },
    hits: [
      {
        _index: 'hybrid_search_resources_en',
        _id: 'doc-1',
        _score: 42,
        _source: { name: 'Shelter', facets: {}, facets_en: {} },
      },
    ],
  },
  aggregations: {},
};

const isRarity = (r: any) => r.size === 0 && !!r.aggs?.df;
const isList = (r: any) => r._source === false && r.size === 100;

/** Every object in a request tree that has a `fuzziness` key. */
const fuzzyClauses = (node: any, out: any[] = []): any[] => {
  if (Array.isArray(node)) node.forEach((n) => fuzzyClauses(n, out));
  else if (node && typeof node === 'object') {
    if ('fuzziness' in node) out.push(node);
    Object.values(node).forEach((v) => fuzzyClauses(v, out));
  }
  return out;
};
const hasFuzziness = (r: any) => JSON.stringify(r).includes('"fuzziness"');

describe('HybridSearchService - typo clause rarity gate (ISS-2793)', () => {
  let service: HybridSearchService;
  let requests: any[];
  let rarityRequests: any[];
  let docsByWord: Record<string, number>;
  let rarityFails: boolean;
  let cacheStore: Map<string, unknown>;
  let setManyCalls: Record<string, unknown>[];

  const build = async () => {
    requests = [];
    rarityRequests = [];
    setManyCalls = [];
    cacheStore = new Map();
    const esSearch = jest.fn((req: any) => {
      if (req.index === 'hybrid_taxonomies') {
        return Promise.resolve({ hits: { hits: [] } });
      }
      if (isRarity(req)) {
        rarityRequests.push(req);
        if (rarityFails) return Promise.reject(new Error('es down'));
        const buckets: Record<string, { doc_count: number }> = {};
        for (const [k, clause] of Object.entries<any>(
          req.aggs.df.filters.filters,
        )) {
          buckets[k] = {
            doc_count: k.startsWith('c')
              ? (docsByWord[clause.multi_match.query] ?? 100)
              : k.startsWith('w')
                ? 50
                : 0,
          };
        }
        return Promise.resolve({
          hits: { total: { value: 1000, relation: 'eq' }, hits: [] },
          aggregations: { df: { buckets } },
        });
      }
      requests.push(req);
      if (isList(req)) return Promise.resolve(hitsOf(['a', 'b']));
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
          useValue: {
            getOrSet: jest.fn((_k: any, f: any) => f()),
            getMany: jest.fn((keys: string[]) =>
              Promise.resolve(keys.map((k) => cacheStore.get(k))),
            ),
            setMany: jest.fn((entries: Record<string, unknown>) => {
              setManyCalls.push(entries);
              Object.entries(entries).forEach(([k, v]) => cacheStore.set(k, v));
              return Promise.resolve();
            }),
            deleteMany: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: MetricsService, useValue: createMetricsServiceMock() },
      ],
    }).compile();

    service = module.get<HybridSearchService>(HybridSearchService);
    jest.spyOn(service, 'embedQuery').mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
  };

  const run = (query: string, v2 = true) =>
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
      ...(v2 ? { rankingVersion: 'v2' } : {}),
    } as any);

  const searchRequests = () => requests;
  const keywordLists = () =>
    requests.filter((r) => isList(r) && !r.query.script_score);

  beforeEach(async () => {
    docsByWord = {};
    rarityFails = false;
    await build();
  });

  it('drops both typo clauses when every content word has 6 or more documents', async () => {
    docsByWord = { food: 6, shelter: 600 };
    await run('food shelter');
    expect(keywordLists().length).toBeGreaterThan(0);
    for (const r of searchRequests()) expect(hasFuzziness(r)).toBe(false);
  });

  it('keeps both typo clauses when a word has exactly 5 documents (5 keeps, 6 drops)', async () => {
    docsByWord = { food: 600, shelter: 5 };
    await run('food shelter');
    const kw = keywordLists()[0];
    const clauses = fuzzyClauses(kw);
    expect(clauses).toHaveLength(2);
    const should = kw.query.bool.should as any[];
    expect(should.some((c) => c.multi_match?.fuzziness)).toBe(true);
    expect(
      should.some(
        (c) =>
          c.nested?.path === 'taxonomies' &&
          c.nested.query.multi_match?.fuzziness,
      ),
    ).toBe(true);
  });

  it('keeps the typo clauses when a word has 0 documents', async () => {
    docsByWord = { food: 600, shelter: 0 };
    await run('food shelter');
    expect(fuzzyClauses(keywordLists()[0])).toHaveLength(2);
  });

  it('keeps the typo clauses and still searches when the rarity probe rejects', async () => {
    rarityFails = true;
    const res = await run('food shelter');
    expect(res.search.hits.hits.length).toBeGreaterThan(0);
    expect(fuzzyClauses(keywordLists()[0])).toHaveLength(2);
  });

  it('keeps the typo clauses for a query of only function words', async () => {
    await run('and the of');
    expect(rarityRequests).toHaveLength(0);
    expect(fuzzyClauses(keywordLists()[0])).toHaveLength(2);
  });

  it('keeps the typo clauses for 12 or more content words, all common', async () => {
    const words = Array.from({ length: 13 }, (_, i) => `wordnumber${i}x`);
    docsByWord = Object.fromEntries(words.map((w) => [w, 900]));
    await run(words.join(' '));
    expect(fuzzyClauses(keywordLists()[0])).toHaveLength(2);
  });

  it('treats a cached entry without docs as a miss and writes docs back', async () => {
    docsByWord = { food: 600, shelter: 600 };
    cacheStore.set(wordRarityCacheKey('tenant-a', 'en', 'food'), {
      idf: 1.2,
      split: null,
    });
    await run('food shelter');
    expect(rarityRequests).toHaveLength(1);
    const filters = rarityRequests[0].aggs.df.filters.filters;
    expect(Object.keys(filters)).toContain('c0');
    expect(filters.c0.multi_match.query).toBe('food');
    const written = cacheStore.get(
      wordRarityCacheKey('tenant-a', 'en', 'food'),
    ) as any;
    expect(written.docs).toBe(600);
    expect(setManyCalls.length).toBeGreaterThan(0);
  });

  it('sends one probe with w, c and split buckets; c is a multi_match on the shared recall fields', async () => {
    await run('food shelter');
    expect(rarityRequests).toHaveLength(1);
    const filters = rarityRequests[0].aggs.df.filters.filters;
    expect(Object.keys(filters)).toEqual(
      expect.arrayContaining(['w0', 'w1', 'c0', 'c1']),
    );
    expect(Object.keys(filters).some((k) => k.startsWith('s'))).toBe(true);
    expect(filters.c0).toEqual({
      multi_match: {
        query: 'food',
        fields: SearchUtilsService.GENERAL_RECALL_FIELDS,
      },
    });
    expect(filters.c1.multi_match.query).toBe('shelter');
  });

  it('v1: no rarity request, typo clauses present, clauses equal the null-rarity build', async () => {
    await run('food shelter', false);
    expect(rarityRequests).toHaveLength(0);
    const sent = JSON.stringify(requests);
    expect(sent).toContain('"fuzziness"');
    const built = (service as any).buildLexicalShouldClauses(
      'food shelter',
      null,
    ) as any[];
    expect(fuzzyClauses(built)).toHaveLength(2);
    for (const clause of built) {
      expect(sent).toContain(JSON.stringify(clause));
    }
  });

  it('typoClauses false removes exactly the two typo clauses and keeps every other clause in place', () => {
    const build2 = (service as any).buildLexicalShouldClauses.bind(service);
    const kept = build2('food shelter', null) as any[];
    const gated = build2('food shelter', {
      words: {},
      splits: [],
      typoClauses: false,
    }) as any[];
    expect(fuzzyClauses(kept)).toHaveLength(2);
    expect(fuzzyClauses(gated)).toHaveLength(0);
    const without = kept.filter((c) => fuzzyClauses(c).length === 0);
    // The name tier differs once a word rarity exists, so compare the tail:
    // everything from the recall clause on, without the typo clauses.
    const tail = (list: any[]) =>
      JSON.stringify(list.slice(list.findIndex((c) => c.multi_match)));
    expect(tail(gated)).toBe(tail(without));
  });
});
